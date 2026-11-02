import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { seedCategory, seedTransaction } from '../helpers/budget-data.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import { ANA, authHeader, BEA, CARLOS, seedBudget, type TestUser } from '../helpers/users.js';

interface Page {
  items: { id: string; date: string; categoryId: string; amount: string }[];
  nextCursor: string | null;
}

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
});

async function list(user: TestUser, budgetId: string, query = '') {
  return app.inject({
    method: 'GET',
    url: `/api/v1/budgets/${budgetId}/transactions${query ? `?${query}` : ''}`,
    headers: await authHeader(user),
  });
}

async function page(user: TestUser, budgetId: string, query = ''): Promise<Page> {
  const response = await list(user, budgetId, query);
  expect(response.statusCode).toBe(200);
  return response.json();
}

/** Recorre todas las páginas siguiendo `nextCursor`. */
async function allPages(user: TestUser, budgetId: string, query: string) {
  const pages: Page[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams(query);
    if (cursor) params.set('cursor', cursor);
    const current = await page(user, budgetId, params.toString());
    pages.push(current);
    cursor = current.nextCursor;
  } while (cursor && pages.length < 20);
  return pages;
}

/** ANA (OWNER) y CARLOS (VIEWER), con una categoría. */
async function budget() {
  const budgetId = await seedBudget([
    { user: ANA, role: 'OWNER' },
    { user: CARLOS, role: 'VIEWER' },
  ]);
  return { budgetId, categoryId: await seedCategory(budgetId) };
}

/** Inserta transacciones en bloque; devuelve sus ids en el orden esperado (date DESC, id DESC). */
async function seedMany(
  budgetId: string,
  categoryId: string,
  dates: string[],
): Promise<{ id: string; date: string }[]> {
  const rows = dates.map((date) => ({ id: randomUUID(), date }));
  await testPrisma.transaction.createMany({
    data: rows.map(({ id, date }) => ({
      id,
      budgetId,
      categoryId,
      createdById: ANA.sub,
      amount: '1.00',
      date: new Date(`${date}T00:00:00.000Z`),
    })),
  });
  return rows.sort((a, b) =>
    a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1,
  );
}

function day(n: number) {
  return `2026-10-${String(n).padStart(2, '0')}`;
}

describe('GET /api/v1/budgets/:id/transactions — paginación por cursor', () => {
  it('devuelve 20 por defecto con nextCursor, y la última página con nextCursor null', async () => {
    const { budgetId, categoryId } = await budget();
    const expected = await seedMany(
      budgetId,
      categoryId,
      Array.from({ length: 25 }, (_, i) => day((i % 28) + 1)),
    );

    const first = await page(CARLOS, budgetId);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await page(CARLOS, budgetId, `cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();

    expect([...first.items, ...second.items].map(({ id }) => id)).toEqual(
      expected.map(({ id }) => id),
    );
  });

  it('ordena de forma estable por date DESC, id DESC (con muchas transacciones el mismo día)', async () => {
    const { budgetId, categoryId } = await budget();
    const expected = await seedMany(budgetId, categoryId, [
      ...Array.from({ length: 7 }, () => day(10)),
      day(12),
      day(3),
      ...Array.from({ length: 4 }, () => day(12)),
    ]);

    const pages = await allPages(CARLOS, budgetId, 'limit=3');

    expect(pages.flatMap(({ items }) => items.map(({ id }) => id))).toEqual(
      expected.map(({ id }) => id),
    );
    expect(pages).toHaveLength(5);
  });

  it('exactamente `limit` elementos: una sola página con nextCursor null', async () => {
    const { budgetId, categoryId } = await budget();
    await seedMany(
      budgetId,
      categoryId,
      Array.from({ length: 20 }, (_, i) => day(i + 1)),
    );

    const first = await page(ANA, budgetId);

    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBeNull();
  });

  it('sin transacciones devuelve una lista vacía', async () => {
    const { budgetId } = await budget();

    await expect(page(ANA, budgetId)).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('el cursor sigue siendo válido aunque se borre la transacción en la que apunta', async () => {
    const { budgetId, categoryId } = await budget();
    const expected = await seedMany(
      budgetId,
      categoryId,
      Array.from({ length: 6 }, () => day(5)),
    );
    const first = await page(ANA, budgetId, 'limit=3');
    await testPrisma.transaction.delete({ where: { id: first.items[2]!.id } });

    const second = await page(ANA, budgetId, `limit=3&cursor=${first.nextCursor}`);

    expect(second.items.map(({ id }) => id)).toEqual(expected.slice(3).map(({ id }) => id));
  });

  it('una transacción más reciente creada entre páginas no se cuela ni duplica', async () => {
    const { budgetId, categoryId } = await budget();
    const expected = await seedMany(budgetId, categoryId, [day(1), day(2), day(3), day(4)]);
    const first = await page(ANA, budgetId, 'limit=2');
    await seedTransaction(budgetId, categoryId, { createdBy: ANA, date: day(28) });

    const second = await page(ANA, budgetId, `limit=2&cursor=${first.nextCursor}`);

    expect(second.items.map(({ id }) => id)).toEqual(expected.slice(2).map(({ id }) => id));
    expect(second.nextCursor).toBeNull();
  });

  it('solo incluye transacciones de este presupuesto', async () => {
    const { budgetId, categoryId } = await budget();
    await seedMany(budgetId, categoryId, [day(1)]);
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    await seedTransaction(other, await seedCategory(other), { createdBy: BEA });

    const result = await page(ANA, budgetId);

    expect(result.items).toHaveLength(1);
  });

  it.each([
    ['limit 0', 'limit=0'],
    ['limit mayor que 100', 'limit=101'],
    ['limit no numérico', 'limit=muchos'],
    ['cursor ilegible', 'cursor=esto-no-es-un-cursor'],
    ['cursor vacío', 'cursor='],
    ['parámetro desconocido', 'orden=asc'],
  ])('rechaza con 400: %s', async (_case, query) => {
    const { budgetId } = await budget();

    const response = await list(ANA, budgetId, query);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('un no miembro recibe 404', async () => {
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await list(ANA, other);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Presupuesto no encontrado' } });
  });
});

describe('GET /api/v1/budgets/:id/transactions — filtros', () => {
  it('filtra por categoría', async () => {
    const { budgetId, categoryId } = await budget();
    const ocio = await seedCategory(budgetId, { name: 'Ocio' });
    await seedMany(budgetId, categoryId, [day(1), day(2)]);
    const expected = await seedMany(budgetId, ocio, [day(3), day(1)]);

    const result = await page(ANA, budgetId, `categoryId=${ocio}`);

    expect(result.items.map(({ id }) => id)).toEqual(expected.map(({ id }) => id));
  });

  it('filtra por rango de fechas, con ambos extremos incluidos', async () => {
    const { budgetId, categoryId } = await budget();
    const all = await seedMany(budgetId, categoryId, [day(1), day(5), day(10), day(15), day(20)]);

    const result = await page(ANA, budgetId, `from=${day(5)}&to=${day(15)}`);

    expect(result.items.map(({ date }) => date)).toEqual([day(15), day(10), day(5)]);
    expect(result.items.map(({ id }) => id)).toEqual(all.slice(1, 4).map(({ id }) => id));
  });

  it('acepta solo uno de los extremos', async () => {
    const { budgetId, categoryId } = await budget();
    await seedMany(budgetId, categoryId, [day(1), day(5), day(10)]);

    const since = await page(ANA, budgetId, `from=${day(5)}`);
    const until = await page(ANA, budgetId, `to=${day(5)}`);

    expect(since.items.map(({ date }) => date)).toEqual([day(10), day(5)]);
    expect(until.items.map(({ date }) => date)).toEqual([day(5), day(1)]);
  });

  it('los filtros se combinan con la paginación', async () => {
    const { budgetId, categoryId } = await budget();
    const ocio = await seedCategory(budgetId, { name: 'Ocio' });
    await seedMany(
      budgetId,
      categoryId,
      Array.from({ length: 5 }, (_, i) => day(i + 1)),
    );
    const expected = (
      await seedMany(
        budgetId,
        ocio,
        Array.from({ length: 7 }, (_, i) => day(i + 1)),
      )
    ).filter(({ date }) => date >= day(2) && date <= day(6));

    const pages = await allPages(
      ANA,
      budgetId,
      `limit=2&categoryId=${ocio}&from=${day(2)}&to=${day(6)}`,
    );

    expect(pages.flatMap(({ items }) => items.map(({ id }) => id))).toEqual(
      expected.map(({ id }) => id),
    );
    expect(pages).toHaveLength(3);
  });

  it('una categoría de otro presupuesto no devuelve nada ajeno', async () => {
    const { budgetId, categoryId } = await budget();
    await seedMany(budgetId, categoryId, [day(1)]);
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedCategory(other);
    await seedTransaction(other, foreign, { createdBy: BEA });

    const result = await page(ANA, budgetId, `categoryId=${foreign}`);

    expect(result).toEqual({ items: [], nextCursor: null });
  });

  it('filtra por isRecurring (true y false) y lo incluye en cada elemento', async () => {
    const { budgetId, categoryId } = await budget();
    const rows = await seedMany(budgetId, categoryId, [day(1), day(2), day(3), day(4)]);
    const recurringIds = [rows[0]!.id, rows[2]!.id];
    await testPrisma.transaction.updateMany({
      where: { id: { in: recurringIds } },
      data: { isRecurring: true },
    });

    const recurring = await page(ANA, budgetId, 'isRecurring=true');
    const oneOff = await page(ANA, budgetId, 'isRecurring=false');

    expect(recurring.items.map(({ id }) => id)).toEqual(recurringIds);
    expect(recurring.items.every((item) => 'isRecurring' in item && item.isRecurring)).toBe(true);
    expect(oneOff.items.map(({ id }) => id)).toEqual([rows[1]!.id, rows[3]!.id]);
  });

  it.each([
    ['isRecurring no booleano', 'isRecurring=quizas'],
    ['from posterior a to', `from=${day(10)}&to=${day(5)}`],
    ['fecha inválida', 'from=2026-02-30'],
    ['fecha con otro formato', 'to=05/10/2026'],
    ['categoryId que no es UUID', 'categoryId=comida'],
  ])('rechaza con 400: %s', async (_case, query) => {
    const { budgetId } = await budget();

    const response = await list(ANA, budgetId, query);

    expect(response.statusCode).toBe(400);
  });
});

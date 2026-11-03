import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { ActivityAction } from '../../src/generated/prisma/client.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import { ANA, authHeader, BEA, CARLOS, seedBudget, type TestUser } from '../helpers/users.js';

const ISO_DATE = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

interface Page {
  items: {
    id: string;
    action: string;
    metadata: unknown;
    createdAt: string;
    actor: { id: string; displayName: string | null; avatarUrl: string | null } | null;
  }[];
  nextCursor: string | null;
}

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
});

async function feed(user: TestUser, budgetId: string, query = '') {
  return app.inject({
    method: 'GET',
    url: `/api/v1/budgets/${budgetId}/activity${query ? `?${query}` : ''}`,
    headers: await authHeader(user),
  });
}

async function page(user: TestUser, budgetId: string, query = ''): Promise<Page> {
  const response = await feed(user, budgetId, query);
  expect(response.statusCode).toBe(200);
  return response.json();
}

/** ANA (OWNER) y CARLOS (VIEWER). */
async function budget() {
  return seedBudget([
    { user: ANA, role: 'OWNER' },
    { user: CARLOS, role: 'VIEWER' },
  ]);
}

/**
 * Inserta entradas en orden (la secuencia crece con cada una). Devuelve sus ids del más
 * reciente al más antiguo, que es el orden del muro.
 */
async function seedActivity(
  budgetId: string,
  count: number,
  {
    user = ANA,
    action = 'TRANSACTION_CREATED',
  }: { user?: TestUser | null; action?: ActivityAction } = {},
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const entry = await testPrisma.activityLog.create({
      data: { budgetId, userId: user?.sub ?? null, action, metadata: { n: i } },
      select: { id: true },
    });
    ids.push(entry.id);
  }
  return ids.reverse();
}

describe('GET /api/v1/budgets/:id/activity', () => {
  it('devuelve las entradas más recientes primero, con su autor', async () => {
    const id = await budget();
    await testPrisma.user.update({
      where: { id: ANA.sub },
      data: { displayName: 'Ana', avatarUrl: 'https://cdn.example.com/ana.png' },
    });
    const [older] = await seedActivity(id, 1, { action: 'CATEGORY_CREATED' });
    const [newer] = await seedActivity(id, 1, { action: 'GOAL_REACHED' });

    const result = await page(CARLOS, id);

    expect(result).toEqual({
      items: [
        {
          id: newer,
          action: 'GOAL_REACHED',
          metadata: { n: 0 },
          createdAt: ISO_DATE,
          actor: { id: ANA.sub, displayName: 'Ana', avatarUrl: 'https://cdn.example.com/ana.png' },
        },
        expect.objectContaining({ id: older, action: 'CATEGORY_CREATED' }),
      ],
      nextCursor: null,
    });
  });

  it('pagina de 20 en 20 por defecto siguiendo nextCursor', async () => {
    const id = await budget();
    const expected = await seedActivity(id, 25);

    const first = await page(ANA, id);
    const second = await page(ANA, id, `cursor=${first.nextCursor}`);

    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map(({ id: entryId }) => entryId)).toEqual(expected);
  });

  it('respeta limit y, con exactamente limit entradas, no hay página siguiente', async () => {
    const id = await budget();
    await seedActivity(id, 3);

    const result = await page(ANA, id, 'limit=3');

    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });

  it('la actividad nueva registrada entre páginas no se cuela ni duplica', async () => {
    const id = await budget();
    const expected = await seedActivity(id, 4);
    const first = await page(ANA, id, 'limit=2');
    await seedActivity(id, 3);

    const second = await page(ANA, id, `limit=2&cursor=${first.nextCursor}`);

    expect(second.items.map(({ id: entryId }) => entryId)).toEqual(expected.slice(2));
    expect(second.nextCursor).toBeNull();
  });

  it('el autor que borró su cuenta aparece anonimizado; sin autor, actor null', async () => {
    const id = await seedBudget([
      { user: ANA, role: 'OWNER' },
      { user: BEA, role: 'EDITOR' },
    ]);
    await testPrisma.user.update({ where: { id: BEA.sub }, data: { displayName: 'Bea' } });
    await seedActivity(id, 1, { user: BEA });
    await seedActivity(id, 1, { user: null });
    await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: await authHeader(BEA) });

    const result = await page(ANA, id);

    // La más reciente es el MEMBER_LEFT del propio borrado de cuenta.
    expect(result.items.map(({ action, actor }) => [action, actor])).toEqual([
      ['MEMBER_LEFT', { id: BEA.sub, displayName: 'Usuario Eliminado', avatarUrl: null }],
      ['TRANSACTION_CREATED', null],
      ['TRANSACTION_CREATED', { id: BEA.sub, displayName: 'Usuario Eliminado', avatarUrl: null }],
    ]);
  });

  it('solo incluye la actividad de este presupuesto', async () => {
    const id = await budget();
    await seedActivity(id, 1);
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    await seedActivity(other, 2, { user: BEA });

    const result = await page(ANA, id);

    expect(result.items).toHaveLength(1);
  });

  it('un no miembro recibe 404', async () => {
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await feed(ANA, other);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Presupuesto no encontrado' } });
  });

  it.each([
    ['limit 0', 'limit=0'],
    ['limit mayor que 100', 'limit=101'],
    ['cursor ilegible', 'cursor=no-es-un-cursor'],
    ['cursor vacío', 'cursor='],
    ['parámetro desconocido', 'action=GOAL_REACHED'],
  ])('rechaza con 400: %s', async (_case, query) => {
    const id = await budget();

    const response = await feed(ANA, id, query);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});

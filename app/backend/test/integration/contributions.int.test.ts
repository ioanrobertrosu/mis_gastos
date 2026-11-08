import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { seedGoal, storedGoal } from '../helpers/budget-data.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import { ANA, authHeader, BEA, CARLOS, DANI, seedBudget, type TestUser } from '../helpers/users.js';

const ISO_DATE = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
});

async function contribute(user: TestUser, budgetId: string, goalId: string, payload: object) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/budgets/${budgetId}/goals/${goalId}/contributions`,
    headers: await authHeader(user),
    payload,
  });
}

/** ANA (OWNER), BEA (EDITOR), DANI (LIMITED_EDITOR) y CARLOS (VIEWER). */
async function familyBudget() {
  return seedBudget([
    { user: ANA, role: 'OWNER' },
    { user: BEA, role: 'EDITOR' },
    { user: DANI, role: 'LIMITED_EDITOR' },
    { user: CARLOS, role: 'VIEWER' },
  ]);
}

describe('POST /api/v1/budgets/:id/goals/:goalId/contributions', () => {
  it.each([
    ['OWNER', ANA],
    ['EDITOR', BEA],
    ['LIMITED_EDITOR', DANI],
  ] as const)(
    'un %s aporta: se registra la contribución y sube currentAmount',
    async (_r, user) => {
      const id = await familyBudget();
      const goal = await seedGoal(id, { targetAmount: '1000.00', currentAmount: '100.00' });

      const response = await contribute(user, id, goal, { amount: '50.25' });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        contribution: {
          id: expect.any(String),
          amount: '50.25',
          userId: user.sub,
          createdAt: ISO_DATE,
        },
        goal: expect.objectContaining({
          id: goal,
          currentAmount: '150.25',
          status: 'IN_PROGRESS',
        }),
      });
      await expect(storedGoal(goal)).resolves.toMatchObject({ currentAmount: '150.25' });
      await expect(
        testPrisma.goalContribution.count({ where: { goalId: goal, userId: user.sub } }),
      ).resolves.toBe(1);
    },
  );

  it('un VIEWER recibe 403 y no cambia nada', async () => {
    const id = await familyBudget();
    const goal = await seedGoal(id, { currentAmount: '100.00' });

    const response = await contribute(CARLOS, id, goal, { amount: '10' });

    expect(response.statusCode).toBe(403);
    await expect(storedGoal(goal)).resolves.toMatchObject({ currentAmount: '100.00' });
    await expect(testPrisma.goalContribution.count()).resolves.toBe(0);
  });

  describe('estado de la meta', () => {
    it('al alcanzar exactamente el objetivo pasa a REACHED', async () => {
      const id = await familyBudget();
      const goal = await seedGoal(id, { targetAmount: '500.00', currentAmount: '450.00' });

      const response = await contribute(ANA, id, goal, { amount: '50' });

      expect(response.json().goal).toMatchObject({ currentAmount: '500.00', status: 'REACHED' });
      await expect(storedGoal(goal)).resolves.toMatchObject({ status: 'REACHED' });
    });

    it('superar el objetivo también la marca REACHED y conserva todo lo aportado', async () => {
      const id = await familyBudget();
      const goal = await seedGoal(id, { targetAmount: '500.00', currentAmount: '490.00' });

      const response = await contribute(ANA, id, goal, { amount: '20' });

      expect(response.json().goal).toMatchObject({ currentAmount: '510.00', status: 'REACHED' });
    });

    it('una meta REACHED sigue admitiendo aportaciones', async () => {
      const id = await familyBudget();
      const goal = await seedGoal(id, {
        targetAmount: '500.00',
        currentAmount: '500.00',
        status: 'REACHED',
      });

      const response = await contribute(BEA, id, goal, { amount: '1' });

      expect(response.statusCode).toBe(201);
      expect(response.json().goal).toMatchObject({ currentAmount: '501.00', status: 'REACHED' });
    });

    it('no se admiten aportaciones a una meta ARCHIVED (409)', async () => {
      const id = await familyBudget();
      const goal = await seedGoal(id, { currentAmount: '100.00', status: 'ARCHIVED' });

      const response = await contribute(ANA, id, goal, { amount: '10' });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: 'CONFLICT' } });
      await expect(storedGoal(goal)).resolves.toMatchObject({ currentAmount: '100.00' });
      await expect(testPrisma.goalContribution.count()).resolves.toBe(0);
    });
  });

  describe('concurrencia', () => {
    it('contribuciones simultáneas no pierden actualizaciones', async () => {
      const id = await familyBudget();
      const goal = await seedGoal(id, { targetAmount: '1000.00' });
      const users = [ANA, BEA, DANI];

      const responses = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          contribute(users[i % users.length]!, id, goal, { amount: '1.10' }),
        ),
      );

      expect(responses.map((response) => response.statusCode)).toEqual(Array(12).fill(201));
      await expect(storedGoal(goal)).resolves.toMatchObject({ currentAmount: '13.20' });
      await expect(testPrisma.goalContribution.count({ where: { goalId: goal } })).resolves.toBe(
        12,
      );
    });

    it('si varias aportaciones simultáneas cruzan el objetivo, el estado final es REACHED', async () => {
      const id = await familyBudget();
      const goal = await seedGoal(id, { targetAmount: '10.00', currentAmount: '7.00' });

      await Promise.all(
        Array.from({ length: 6 }, () => contribute(ANA, id, goal, { amount: '1.00' })),
      );

      await expect(storedGoal(goal)).resolves.toMatchObject({
        currentAmount: '13.00',
        status: 'REACHED',
      });
    });

    it('archivar mientras se aporta: o la aportación entra antes, o se rechaza con 409', async () => {
      const id = await familyBudget();
      const goal = await seedGoal(id, { currentAmount: '0.00' });

      const [contributed, archived] = await Promise.all([
        contribute(DANI, id, goal, { amount: '5.00' }),
        app.inject({
          method: 'PATCH',
          url: `/api/v1/budgets/${id}/goals/${goal}`,
          headers: await authHeader(ANA),
          payload: { archived: true },
        }),
      ]);

      expect(archived.statusCode).toBe(200);
      expect([201, 409]).toContain(contributed.statusCode);
      const stored = await storedGoal(goal);
      const contributions = await testPrisma.goalContribution.count({ where: { goalId: goal } });
      // La suma guardada siempre cuadra con las contribuciones registradas.
      expect(stored).toMatchObject({
        status: 'ARCHIVED',
        currentAmount: contributions === 1 ? '5.00' : '0.00',
      });
      expect(contributions).toBe(contributed.statusCode === 201 ? 1 : 0);
    });
  });

  it('una meta de otro presupuesto o inexistente devuelve 404 "Meta no encontrada"', async () => {
    const id = await familyBudget();
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedGoal(other, { currentAmount: '0.00' });

    const ajena = await contribute(ANA, id, foreign, { amount: '10' });
    const missing = await contribute(ANA, id, MISSING_ID, { amount: '10' });

    expect(ajena.statusCode).toBe(404);
    expect(ajena.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Meta no encontrada' } });
    expect(missing.statusCode).toBe(404);
    await expect(storedGoal(foreign)).resolves.toMatchObject({ currentAmount: '0.00' });
  });

  it('un no miembro recibe 404 "Presupuesto no encontrado"', async () => {
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const goal = await seedGoal(other);

    const response = await contribute(ANA, other, goal, { amount: '10' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Presupuesto no encontrado' } });
  });

  it.each([
    ['importe cero', { amount: '0' }],
    ['importe negativo', { amount: '-5' }],
    ['importe como número JSON', { amount: 5 }],
    ['importe con 3 decimales', { amount: '5.001' }],
    ['sin importe', {}],
    ['campo no permitido', { amount: '5', userId: BEA.sub }],
  ])('rechaza con 400: %s', async (_case, payload) => {
    const id = await familyBudget();
    const goal = await seedGoal(id, { currentAmount: '0.00' });

    const response = await contribute(ANA, id, goal, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await expect(storedGoal(goal)).resolves.toMatchObject({ currentAmount: '0.00' });
  });
});

describe('GET /api/v1/budgets/:id/goals/:goalId/contributions', () => {
  async function listContributions(user: TestUser, budgetId: string, goalId: string, query = '') {
    return app.inject({
      method: 'GET',
      url: `/api/v1/budgets/${budgetId}/goals/${goalId}/contributions${query ? `?${query}` : ''}`,
      headers: await authHeader(user),
    });
  }

  /** Recorre todas las páginas siguiendo `nextCursor`. */
  async function allPages(user: TestUser, budgetId: string, goalId: string, limit: number) {
    const pages: { items: { id: string }[]; nextCursor: string | null }[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`;
      const response = await listContributions(user, budgetId, goalId, query);
      expect(response.statusCode).toBe(200);
      pages.push(response.json());
      cursor = pages.at(-1)!.nextCursor;
    } while (cursor);
    return pages;
  }

  async function seedContribution(
    goalId: string,
    user: TestUser | null,
    amount: string,
    createdAt: string,
  ) {
    const contribution = await testPrisma.goalContribution.create({
      data: { goalId, userId: user?.sub ?? null, amount, createdAt: new Date(createdAt) },
    });
    return contribution.id;
  }

  it('cualquier miembro ve las contribuciones de la meta, más recientes primero, con su autor', async () => {
    const id = await familyBudget();
    await testPrisma.user.update({
      where: { id: BEA.sub },
      data: { displayName: 'Bea', avatarUrl: 'https://cdn.example.com/bea.png' },
    });
    const goal = await seedGoal(id);
    const older = await seedContribution(goal, DANI, '10.00', '2026-10-01T10:00:00.000Z');
    const newer = await seedContribution(goal, BEA, '25.50', '2026-10-02T10:00:00.000Z');
    const otherGoal = await seedGoal(id, { title: 'Otra' });
    await seedContribution(otherGoal, ANA, '99.00', '2026-10-03T10:00:00.000Z');

    const response = await listContributions(CARLOS, id, goal);

    expect(response.statusCode).toBe(200);
    expect(response.json().nextCursor).toBeNull();
    expect(response.json().items).toEqual([
      {
        id: newer,
        amount: '25.50',
        createdAt: '2026-10-02T10:00:00.000Z',
        author: { id: BEA.sub, displayName: 'Bea', avatarUrl: 'https://cdn.example.com/bea.png' },
      },
      {
        id: older,
        amount: '10.00',
        createdAt: '2026-10-01T10:00:00.000Z',
        author: { id: DANI.sub, displayName: null, avatarUrl: null },
      },
    ]);
  });

  it('el autor que borró su cuenta aparece como "Usuario Eliminado" y el importe se conserva', async () => {
    const id = await familyBudget();
    await testPrisma.user.update({
      where: { id: DANI.sub },
      data: { displayName: 'Dani', avatarUrl: 'https://cdn.example.com/dani.png' },
    });
    const goal = await seedGoal(id);
    await contribute(DANI, id, goal, { amount: '40.00' });
    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me',
      headers: await authHeader(DANI),
    });
    expect(deleted.statusCode).toBe(204);

    const response = await listContributions(ANA, id, goal);

    expect(response.json().items).toEqual([
      expect.objectContaining({
        amount: '40.00',
        author: { id: DANI.sub, displayName: 'Usuario Eliminado', avatarUrl: null },
      }),
    ]);
  });

  it('una contribución sin autor (usuario eliminado físicamente) tiene author null', async () => {
    const id = await familyBudget();
    const goal = await seedGoal(id);
    await seedContribution(goal, null, '5.00', '2026-10-01T10:00:00.000Z');

    const response = await listContributions(ANA, id, goal);

    expect(response.json().items).toEqual([
      expect.objectContaining({ amount: '5.00', author: null }),
    ]);
  });

  it('una meta sin contribuciones devuelve una lista vacía', async () => {
    const id = await familyBudget();
    const goal = await seedGoal(id);

    const response = await listContributions(ANA, id, goal);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
  });

  describe('paginación', () => {
    it('pagina de 20 en 20 por defecto siguiendo nextCursor, más recientes primero', async () => {
      const id = await familyBudget();
      const goal = await seedGoal(id);
      const ids: string[] = [];
      for (let i = 0; i < 25; i++) {
        const minute = String(i).padStart(2, '0');
        ids.push(await seedContribution(goal, ANA, '1.00', `2026-10-01T10:${minute}:00.000Z`));
      }

      const first = await listContributions(ANA, id, goal);
      const firstPage = first.json();
      const second = await listContributions(ANA, id, goal, `cursor=${firstPage.nextCursor}`);

      expect(firstPage.items.map((item: { id: string }) => item.id)).toEqual(
        ids.slice(5).reverse(),
      );
      expect(firstPage.nextCursor).toEqual(expect.any(String));
      expect(second.json()).toEqual({
        items: ids
          .slice(0, 5)
          .reverse()
          .map((itemId) => expect.objectContaining({ id: itemId })),
        nextCursor: null,
      });
    });

    it('con exactamente limit contribuciones no hay página siguiente', async () => {
      const id = await familyBudget();
      const goal = await seedGoal(id);
      await seedContribution(goal, ANA, '1.00', '2026-10-01T10:00:00.000Z');
      await seedContribution(goal, ANA, '2.00', '2026-10-02T10:00:00.000Z');

      const response = await listContributions(ANA, id, goal, 'limit=2');

      expect(response.json().items).toHaveLength(2);
      expect(response.json().nextCursor).toBeNull();
    });

    it('las contribuciones con el mismo createdAt no se pierden ni se repiten entre páginas', async () => {
      const id = await familyBudget();
      const goal = await seedGoal(id);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(await seedContribution(goal, ANA, '1.00', '2026-10-01T10:00:00.000Z'));
      }

      const pages = await allPages(ANA, id, goal, 2);

      const seen = pages.flatMap((page) => page.items.map((item) => item.id));
      expect(pages).toHaveLength(3);
      expect(seen).toHaveLength(5);
      expect(new Set(seen)).toEqual(new Set(ids));
    });

    it('una contribución nueva entre páginas no se cuela ni duplica', async () => {
      const id = await familyBudget();
      const goal = await seedGoal(id);
      await seedContribution(goal, ANA, '1.00', '2026-10-01T10:00:00.000Z');
      await seedContribution(goal, ANA, '2.00', '2026-10-02T10:00:00.000Z');
      await seedContribution(goal, ANA, '3.00', '2026-10-03T10:00:00.000Z');

      const first = (await listContributions(ANA, id, goal, 'limit=2')).json();
      await contribute(BEA, id, goal, { amount: '9.00' });
      const second = (
        await listContributions(ANA, id, goal, `limit=2&cursor=${first.nextCursor}`)
      ).json();

      expect(first.items.map((item: { amount: string }) => item.amount)).toEqual(['3.00', '2.00']);
      expect(second).toEqual({
        items: [expect.objectContaining({ amount: '1.00' })],
        nextCursor: null,
      });
    });

    it.each([
      ['limit 0', 'limit=0'],
      ['limit mayor que 100', 'limit=101'],
      ['cursor ilegible', 'cursor=no-es-un-cursor'],
      ['cursor vacío', 'cursor='],
      ['parámetro desconocido', 'order=asc'],
    ])('rechaza con 400: %s', async (_case, query) => {
      const id = await familyBudget();
      const goal = await seedGoal(id);

      const response = await listContributions(ANA, id, goal, query);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    });
  });

  it('una meta de otro presupuesto devuelve 404 "Meta no encontrada"', async () => {
    const id = await familyBudget();
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedGoal(other);
    await seedContribution(foreign, BEA, '1.00', '2026-10-01T10:00:00.000Z');

    const response = await listContributions(ANA, id, foreign);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Meta no encontrada' },
    });
  });

  it('un no miembro recibe 404 "Presupuesto no encontrado"', async () => {
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const goal = await seedGoal(other);

    const response = await listContributions(ANA, other, goal);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Presupuesto no encontrado' } });
  });
});

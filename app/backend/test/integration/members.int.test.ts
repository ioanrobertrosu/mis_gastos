import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import { ANA, authHeader, BEA, CARLOS, seedBudget, type TestUser } from '../helpers/users.js';

const ISO_DATE = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
});

async function api(
  user: TestUser,
  method: 'GET' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: await authHeader(user),
    ...(payload === undefined ? {} : { payload }),
  });
}

/** ANA (OWNER), BEA (EDITOR) y CARLOS (VIEWER), incorporados en ese orden. */
async function familyBudget() {
  return seedBudget([
    { user: ANA, role: 'OWNER' },
    { user: BEA, role: 'EDITOR' },
    { user: CARLOS, role: 'VIEWER' },
  ]);
}

async function roleOf(user: TestUser, budgetId: string) {
  const member = await testPrisma.budgetMember.findUnique({
    where: { userId_budgetId: { userId: user.sub, budgetId } },
    select: { role: true },
  });
  return member?.role ?? null;
}

describe('GET /api/v1/budgets/:id/members', () => {
  it('cualquier miembro ve la lista de miembros por orden de incorporación', async () => {
    const id = await familyBudget();
    await testPrisma.user.update({ where: { id: BEA.sub }, data: { displayName: 'Bea' } });

    const response = await api(CARLOS, 'GET', `/budgets/${id}/members`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        userId: ANA.sub,
        email: ANA.email,
        displayName: null,
        avatarUrl: null,
        role: 'OWNER',
        joinedAt: ISO_DATE,
      },
      expect.objectContaining({ userId: BEA.sub, displayName: 'Bea', role: 'EDITOR' }),
      expect.objectContaining({ userId: CARLOS.sub, role: 'VIEWER' }),
    ]);
  });

  it('un no miembro recibe 404', async () => {
    const id = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await api(ANA, 'GET', `/budgets/${id}/members`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Presupuesto no encontrado' } });
  });
});

describe('PATCH /api/v1/budgets/:id/members/:userId', () => {
  it('el OWNER cambia el rol de un miembro', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'PATCH', `/budgets/${id}/members/${BEA.sub}`, {
      role: 'LIMITED_EDITOR',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ userId: BEA.sub, role: 'LIMITED_EDITOR' });
    await expect(roleOf(BEA, id)).resolves.toBe('LIMITED_EDITOR');
  });

  it('no permite asignar OWNER (eso es una transferencia de propiedad)', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'PATCH', `/budgets/${id}/members/${BEA.sub}`, {
      role: 'OWNER',
    });

    expect(response.statusCode).toBe(400);
    await expect(roleOf(BEA, id)).resolves.toBe('EDITOR');
  });

  it('el OWNER no puede cambiar su propio rol sin transferir la propiedad (409)', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'PATCH', `/budgets/${id}/members/${ANA.sub}`, {
      role: 'EDITOR',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    await expect(roleOf(ANA, id)).resolves.toBe('OWNER');
  });

  it('un miembro que no es OWNER recibe 403', async () => {
    const id = await familyBudget();

    const response = await api(BEA, 'PATCH', `/budgets/${id}/members/${CARLOS.sub}`, {
      role: 'EDITOR',
    });

    expect(response.statusCode).toBe(403);
    await expect(roleOf(CARLOS, id)).resolves.toBe('VIEWER');
  });

  it('un usuario que no es miembro devuelve 404 "Miembro no encontrado"', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'PATCH', `/budgets/${id}/members/${MISSING_ID}`, {
      role: 'EDITOR',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Miembro no encontrado' },
    });
  });

  it.each([
    ['userId que no es UUID', 'no-es-un-uuid', { role: 'EDITOR' }],
    ['sin rol', BEA.sub, {}],
    ['campo no permitido', BEA.sub, { role: 'EDITOR', joinedAt: '2020-01-01T00:00:00.000Z' }],
  ])('rechaza con 400: %s', async (_case, userId, payload) => {
    const id = await familyBudget();

    const response = await api(ANA, 'PATCH', `/budgets/${id}/members/${userId}`, payload);

    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /api/v1/budgets/:id/members/:userId', () => {
  it('el OWNER expulsa a un miembro, que deja de ver el presupuesto', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'DELETE', `/budgets/${id}/members/${BEA.sub}`);

    expect(response.statusCode).toBe(204);
    await expect(roleOf(BEA, id)).resolves.toBeNull();
    // El usuario sigue existiendo; solo pierde el acceso.
    await expect(testPrisma.user.count({ where: { id: BEA.sub } })).resolves.toBe(1);
    expect((await api(BEA, 'GET', `/budgets/${id}`)).statusCode).toBe(404);
  });

  it('el OWNER no puede expulsarse a sí mismo (409)', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'DELETE', `/budgets/${id}/members/${ANA.sub}`);

    expect(response.statusCode).toBe(409);
    await expect(roleOf(ANA, id)).resolves.toBe('OWNER');
  });

  it('un miembro que no es OWNER recibe 403', async () => {
    const id = await familyBudget();

    const response = await api(BEA, 'DELETE', `/budgets/${id}/members/${CARLOS.sub}`);

    expect(response.statusCode).toBe(403);
    await expect(roleOf(CARLOS, id)).resolves.toBe('VIEWER');
  });

  it('un usuario que no es miembro devuelve 404 "Miembro no encontrado"', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'DELETE', `/budgets/${id}/members/${MISSING_ID}`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Miembro no encontrado' } });
  });
});

describe('DELETE /api/v1/budgets/:id/membership (abandonar)', () => {
  it('un miembro que no es OWNER abandona el presupuesto', async () => {
    const id = await familyBudget();

    const response = await api(BEA, 'DELETE', `/budgets/${id}/membership`);

    expect(response.statusCode).toBe(204);
    await expect(roleOf(BEA, id)).resolves.toBeNull();
    await expect(testPrisma.budget.count({ where: { id } })).resolves.toBe(1);
  });

  it('el OWNER no puede abandonar sin transferir antes la propiedad (409)', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'DELETE', `/budgets/${id}/membership`);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    await expect(roleOf(ANA, id)).resolves.toBe('OWNER');
  });

  it('un no miembro recibe 404', async () => {
    const id = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await api(ANA, 'DELETE', `/budgets/${id}/membership`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Presupuesto no encontrado' } });
  });
});

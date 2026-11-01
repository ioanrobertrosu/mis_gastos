import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import { ANA, authHeader, BEA, CARLOS, seedBudget, type TestUser } from '../helpers/users.js';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
});

async function api(
  user: TestUser,
  method: 'POST' | 'PATCH' | 'DELETE',
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

function transfer(user: TestUser, budgetId: string, payload: object) {
  return api(user, 'POST', `/budgets/${budgetId}/ownership`, payload);
}

/** ANA (OWNER), BEA (EDITOR) y CARLOS (VIEWER), incorporados en ese orden. */
async function familyBudget() {
  return seedBudget([
    { user: ANA, role: 'OWNER' },
    { user: BEA, role: 'EDITOR' },
    { user: CARLOS, role: 'VIEWER' },
  ]);
}

async function roles(budgetId: string) {
  const members = await testPrisma.budgetMember.findMany({
    where: { budgetId },
    select: { userId: true, role: true },
  });
  return Object.fromEntries(members.map(({ userId, role }) => [userId, role]));
}

async function ownerCount(budgetId: string) {
  return testPrisma.budgetMember.count({ where: { budgetId, role: 'OWNER' } });
}

describe('POST /api/v1/budgets/:id/ownership', () => {
  it('intercambia los roles: el destinatario pasa a OWNER y el OWNER asume su rol anterior', async () => {
    const id = await familyBudget();

    const response = await transfer(ANA, id, { userId: BEA.sub });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id, role: 'EDITOR' });
    await expect(roles(id)).resolves.toEqual({
      [ANA.sub]: 'EDITOR',
      [BEA.sub]: 'OWNER',
      [CARLOS.sub]: 'VIEWER',
    });
  });

  it('transferir a un VIEWER deja al antiguo OWNER como VIEWER', async () => {
    const id = await familyBudget();

    const response = await transfer(ANA, id, { userId: CARLOS.sub });

    expect(response.statusCode).toBe(200);
    await expect(roles(id)).resolves.toMatchObject({ [ANA.sub]: 'VIEWER', [CARLOS.sub]: 'OWNER' });
  });

  it('el nuevo OWNER gestiona el presupuesto y el anterior pierde ese permiso', async () => {
    const id = await familyBudget();
    await transfer(ANA, id, { userId: BEA.sub });

    expect((await api(BEA, 'PATCH', `/budgets/${id}`, { name: 'De Bea' })).statusCode).toBe(200);
    expect((await api(ANA, 'PATCH', `/budgets/${id}`, { name: 'De Ana' })).statusCode).toBe(403);
  });

  it('tras transferir, el antiguo OWNER puede abandonar el presupuesto', async () => {
    const id = await familyBudget();
    await transfer(ANA, id, { userId: BEA.sub });

    const response = await api(ANA, 'DELETE', `/budgets/${id}/membership`);

    expect(response.statusCode).toBe(204);
    await expect(roles(id)).resolves.toEqual({ [BEA.sub]: 'OWNER', [CARLOS.sub]: 'VIEWER' });
  });

  it('transferirse la propiedad a sí mismo devuelve 409', async () => {
    const id = await familyBudget();

    const response = await transfer(ANA, id, { userId: ANA.sub });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    await expect(roles(id)).resolves.toMatchObject({ [ANA.sub]: 'OWNER' });
  });

  it('un destinatario que no es miembro devuelve 404 "Miembro no encontrado"', async () => {
    const id = await familyBudget();

    const response = await transfer(ANA, id, { userId: MISSING_ID });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Miembro no encontrado' },
    });
    await expect(ownerCount(id)).resolves.toBe(1);
  });

  it('un miembro que no es OWNER recibe 403', async () => {
    const id = await familyBudget();

    const response = await transfer(BEA, id, { userId: BEA.sub });

    expect(response.statusCode).toBe(403);
    await expect(roles(id)).resolves.toMatchObject({ [ANA.sub]: 'OWNER', [BEA.sub]: 'EDITOR' });
  });

  it('un no miembro recibe 404 "Presupuesto no encontrado"', async () => {
    const id = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await transfer(ANA, id, { userId: BEA.sub });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Presupuesto no encontrado' } });
  });

  it.each([
    ['userId que no es UUID', { userId: 'no-es-un-uuid' }],
    ['sin userId', {}],
    ['campo no permitido', { userId: BEA.sub, role: 'VIEWER' }],
  ])('rechaza con 400: %s', async (_case, payload) => {
    const id = await familyBudget();

    const response = await transfer(ANA, id, payload);

    expect(response.statusCode).toBe(400);
    await expect(ownerCount(id)).resolves.toBe(1);
  });

  describe('concurrencia: siempre queda exactamente un OWNER', () => {
    it('dos transferencias simultáneas: solo una se aplica', async () => {
      const id = await familyBudget();

      const responses = await Promise.all([
        transfer(ANA, id, { userId: BEA.sub }),
        transfer(ANA, id, { userId: CARLOS.sub }),
      ]);

      // La segunda, bajo el bloqueo, ve que ANA ya no es OWNER.
      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 403]);
      await expect(ownerCount(id)).resolves.toBe(1);
      await expect(roles(id)).resolves.not.toMatchObject({ [ANA.sub]: 'OWNER' });
    });

    it('transferir y expulsar al destinatario a la vez', async () => {
      const id = await familyBudget();

      const [transferred, removed] = await Promise.all([
        transfer(ANA, id, { userId: BEA.sub }),
        api(ANA, 'DELETE', `/budgets/${id}/members/${BEA.sub}`),
      ]);

      const outcome = [transferred.statusCode, removed.statusCode];
      // Transferencia primero → ANA ya no puede expulsar (403).
      // Expulsión primero → BEA ya no es miembro (404 "Miembro no encontrado").
      expect([
        [200, 403],
        [404, 204],
      ]).toContainEqual(outcome);
      if (transferred.statusCode === 404) {
        expect(transferred.json()).toMatchObject({ error: { message: 'Miembro no encontrado' } });
      }
      await expect(ownerCount(id)).resolves.toBe(1);
    });

    it('transferir y cambiar el rol del destinatario a la vez', async () => {
      const id = await familyBudget();

      const [transferred, changed] = await Promise.all([
        transfer(ANA, id, { userId: BEA.sub }),
        api(ANA, 'PATCH', `/budgets/${id}/members/${BEA.sub}`, { role: 'VIEWER' }),
      ]);

      // Transferencia primero → 403 al cambiar el rol. Cambio primero → BEA (VIEWER) pasa a
      // OWNER y ANA a VIEWER.
      expect([
        [200, 403],
        [200, 200],
      ]).toContainEqual([transferred.statusCode, changed.statusCode]);
      await expect(ownerCount(id)).resolves.toBe(1);
      await expect(roles(id)).resolves.toMatchObject({ [BEA.sub]: 'OWNER' });
    });
  });
});

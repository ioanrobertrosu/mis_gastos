import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import {
  ANA,
  authHeader,
  BEA,
  CARLOS,
  DANI,
  EVA,
  seedBudget,
  seedUser,
  type TestUser,
} from '../helpers/users.js';

const UUID = expect.stringMatching(/^[0-9a-f-]{36}$/);
const ISO_DATE = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const HOUR = 3_600_000;

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
});

async function api(
  user: TestUser | null,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  payload?: object,
) {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: user ? await authHeader(user) : {},
    ...(payload === undefined ? {} : { payload }),
  });
}

/** Presupuesto de ANA (OWNER) con una invitación; devuelve ids y token. */
async function budgetWithInvite(body: object = {}) {
  const budgetId = await seedBudget([{ user: ANA, role: 'OWNER' }], { name: 'Casa' });
  const response = await api(ANA, 'POST', `/budgets/${budgetId}/invitations`, body);
  const { id, token } = response.json() as { id: string; token: string };
  return { budgetId, inviteId: id, token };
}

const accept = (user: TestUser, token: string) => api(user, 'POST', `/invitations/${token}/accept`);

describe('POST /api/v1/budgets/:id/invitations', () => {
  it('el OWNER crea una invitación de un solo uso (LIMITED_EDITOR y 48 h por defecto)', async () => {
    const budgetId = await seedBudget([{ user: ANA, role: 'OWNER' }]);
    const before = Date.now();

    const response = await api(ANA, 'POST', `/budgets/${budgetId}/invitations`, {});

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toEqual({
      id: UUID,
      token: UUID,
      role: 'LIMITED_EDITOR',
      expiresAt: ISO_DATE,
      createdAt: ISO_DATE,
    });
    const ttl = Date.parse(body.expiresAt) - before;
    expect(ttl).toBeGreaterThan(48 * HOUR - 60_000);
    expect(ttl).toBeLessThan(48 * HOUR + 60_000);
    await expect(
      testPrisma.oneTimeInvite.findUnique({
        where: { id: body.id },
        select: { budgetId: true, createdById: true, isUsed: true },
      }),
    ).resolves.toEqual({ budgetId, createdById: ANA.sub, isUsed: false });
  });

  it('respeta el rol y la caducidad indicados', async () => {
    const budgetId = await seedBudget([{ user: ANA, role: 'OWNER' }]);
    const before = Date.now();

    const response = await api(ANA, 'POST', `/budgets/${budgetId}/invitations`, {
      role: 'EDITOR',
      expiresInHours: 1,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ role: 'EDITOR' });
    expect(Date.parse(response.json().expiresAt) - before).toBeLessThan(HOUR + 60_000);
  });

  it.each([
    ['rol OWNER', { role: 'OWNER' }],
    ['rol desconocido', { role: 'ADMIN' }],
    ['caducidad 0', { expiresInHours: 0 }],
    ['caducidad de más de 7 días', { expiresInHours: 169 }],
    ['campo no permitido', { token: 'elegido-por-mi' }],
  ])('rechaza con 400 un cuerpo inválido: %s', async (_case, payload) => {
    const budgetId = await seedBudget([{ user: ANA, role: 'OWNER' }]);

    const response = await api(ANA, 'POST', `/budgets/${budgetId}/invitations`, payload);

    expect(response.statusCode).toBe(400);
    await expect(testPrisma.oneTimeInvite.count()).resolves.toBe(0);
  });

  it('un miembro que no es OWNER recibe 403', async () => {
    const budgetId = await seedBudget([
      { user: BEA, role: 'OWNER' },
      { user: ANA, role: 'EDITOR' },
    ]);

    const response = await api(ANA, 'POST', `/budgets/${budgetId}/invitations`, {});

    expect(response.statusCode).toBe(403);
  });

  it('un no miembro recibe 404', async () => {
    const budgetId = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await api(ANA, 'POST', `/budgets/${budgetId}/invitations`, {});

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Presupuesto no encontrado' },
    });
  });
});

describe('POST /api/v1/invitations/:token/accept', () => {
  it('crea la membresía con el rol de la invitación y la marca como usada', async () => {
    const { budgetId, token } = await budgetWithInvite({ role: 'VIEWER' });

    const response = await accept(BEA, token);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: budgetId,
      name: 'Casa',
      role: 'VIEWER',
      memberCount: 2,
    });
    await expect(
      testPrisma.budgetMember.findUnique({
        where: { userId_budgetId: { userId: BEA.sub, budgetId } },
        select: { role: true },
      }),
    ).resolves.toEqual({ role: 'VIEWER' });
    await expect(
      testPrisma.oneTimeInvite.findUnique({ where: { token }, select: { isUsed: true } }),
    ).resolves.toEqual({ isUsed: true });
  });

  it('un token inexistente devuelve 404', async () => {
    const response = await accept(BEA, MISSING_ID);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Invitación no encontrada' },
    });
  });

  it('una invitación ya usada devuelve 410 INVITATION_USED', async () => {
    const { token } = await budgetWithInvite();
    await accept(BEA, token);

    const response = await accept(CARLOS, token);

    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual({
      error: { code: 'INVITATION_USED', message: expect.any(String) },
    });
  });

  it('una invitación caducada devuelve 410 INVITATION_EXPIRED y no crea membresía', async () => {
    const { budgetId, token } = await budgetWithInvite();
    await testPrisma.oneTimeInvite.update({
      where: { token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await accept(BEA, token);

    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({ error: { code: 'INVITATION_EXPIRED' } });
    await expect(testPrisma.budgetMember.count({ where: { budgetId } })).resolves.toBe(1);
  });

  it('con el presupuesto lleno (4 miembros) devuelve 422 y la invitación sigue disponible', async () => {
    const budgetId = await seedBudget([
      { user: ANA, role: 'OWNER' },
      { user: BEA, role: 'EDITOR' },
      { user: CARLOS, role: 'EDITOR' },
      { user: DANI, role: 'VIEWER' },
    ]);
    const { token } = (await api(ANA, 'POST', `/budgets/${budgetId}/invitations`, {})).json() as {
      token: string;
    };

    const response = await accept(EVA, token);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'LIMIT_EXCEEDED' } });
    await expect(testPrisma.budgetMember.count({ where: { budgetId } })).resolves.toBe(4);
    await expect(
      testPrisma.oneTimeInvite.findUnique({ where: { token }, select: { isUsed: true } }),
    ).resolves.toEqual({ isUsed: false });
  });

  it('si el usuario ya pertenece a 3 presupuestos devuelve 422', async () => {
    const { budgetId, token } = await budgetWithInvite();
    for (let i = 0; i < 3; i++) await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await accept(BEA, token);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'LIMIT_EXCEEDED' } });
    await expect(testPrisma.budgetMember.count({ where: { budgetId } })).resolves.toBe(1);
  });

  it('si el usuario ya es miembro devuelve 409 y no consume la invitación', async () => {
    const { token } = await budgetWithInvite();

    const response = await accept(ANA, token);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    await expect(
      testPrisma.oneTimeInvite.findUnique({ where: { token }, select: { isUsed: true } }),
    ).resolves.toEqual({ isUsed: false });
  });

  it('dos aceptaciones simultáneas solo crean una membresía', async () => {
    const { budgetId, token } = await budgetWithInvite();

    const responses = await Promise.all([accept(BEA, token), accept(CARLOS, token)]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 410]);
    await expect(testPrisma.budgetMember.count({ where: { budgetId } })).resolves.toBe(2);
  });

  it('un token que no es UUID devuelve 400', async () => {
    const response = await accept(BEA, 'no-es-un-uuid');

    expect(response.statusCode).toBe(400);
  });

  it('sin autenticación devuelve 401', async () => {
    const { token } = await budgetWithInvite();

    const response = await api(null, 'POST', `/invitations/${token}/accept`);

    expect(response.statusCode).toBe(401);
  });
});

describe('DELETE /api/v1/budgets/:id/invitations/:inviteId', () => {
  it('el OWNER revoca la invitación y ya no se puede aceptar', async () => {
    const { budgetId, inviteId, token } = await budgetWithInvite();

    const response = await api(ANA, 'DELETE', `/budgets/${budgetId}/invitations/${inviteId}`);

    expect(response.statusCode).toBe(204);
    expect((await accept(BEA, token)).statusCode).toBe(404);
  });

  it('un miembro que no es OWNER recibe 403', async () => {
    const { budgetId, inviteId } = await budgetWithInvite();
    await seedUser(BEA);
    await testPrisma.budgetMember.create({ data: { userId: BEA.sub, budgetId, role: 'EDITOR' } });

    const response = await api(BEA, 'DELETE', `/budgets/${budgetId}/invitations/${inviteId}`);

    expect(response.statusCode).toBe(403);
    await expect(testPrisma.oneTimeInvite.count()).resolves.toBe(1);
  });

  it('una invitación de otro presupuesto devuelve 404', async () => {
    const { inviteId } = await budgetWithInvite();
    const otherBudget = await seedBudget([{ user: ANA, role: 'OWNER' }]);

    const response = await api(ANA, 'DELETE', `/budgets/${otherBudget}/invitations/${inviteId}`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Invitación no encontrada' },
    });
    await expect(testPrisma.oneTimeInvite.count()).resolves.toBe(1);
  });
});

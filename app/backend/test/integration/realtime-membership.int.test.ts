import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import { ANA, authHeader, BEA, CARLOS, seedBudget, type TestUser } from '../helpers/users.js';
import { HandshakeRejected, TestClients } from '../helpers/ws.js';

let app: FastifyInstance;
let clients: TestClients;

beforeAll(async () => {
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
  await app.listen({ port: 0, host: '127.0.0.1' });
  clients = new TestClients(app);
});

afterEach(() => {
  clients.closeAll();
});

afterAll(async () => {
  await app.close();
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

/** ANA (OWNER), BEA (EDITOR) y CARLOS (VIEWER). */
async function familyBudget() {
  return seedBudget([
    { user: ANA, role: 'OWNER' },
    { user: BEA, role: 'EDITOR' },
    { user: CARLOS, role: 'VIEWER' },
  ]);
}

/** Conexión de `user`, suscrita a los presupuestos indicados. */
async function subscribed(user: TestUser, ...budgetIds: string[]) {
  const client = await clients.connect(await authHeader(user));
  for (const budgetId of budgetIds) {
    client.send({ type: 'subscribe', budgetId });
    await expect(client.next()).resolves.toEqual({ type: 'subscribed', budgetId });
  }
  return client;
}

function touchBudget(budgetId: string) {
  return api(ANA, 'PATCH', `/budgets/${budgetId}`, { name: `Hogar ${Date.now()}` });
}

describe('pérdida de la membresía', () => {
  describe('expulsión', () => {
    it('el expulsado sale de la sala al momento, se le avisa y deja de recibir eventos', async () => {
      const budgetId = await familyBudget();
      const expelled = await subscribed(BEA, budgetId);
      const other = await subscribed(CARLOS, budgetId);

      await api(ANA, 'DELETE', `/budgets/${budgetId}/members/${BEA.sub}`);

      await expect(expelled.next()).resolves.toEqual({
        type: 'unsubscribed',
        budgetId,
        reason: 'REMOVED',
      });
      await expect(other.next()).resolves.toMatchObject({ type: 'deleted', entity: 'member' });

      await touchBudget(budgetId);

      await expect(other.next()).resolves.toMatchObject({ type: 'updated', entity: 'budget' });
      await expelled.expectSilence();
      expect(expelled.isOpen).toBe(true);
    });

    it('afecta a todas las conexiones del expulsado', async () => {
      const budgetId = await familyBudget();
      const phone = await subscribed(BEA, budgetId);
      const laptop = await subscribed(BEA, budgetId);

      await api(ANA, 'DELETE', `/budgets/${budgetId}/members/${BEA.sub}`);

      const notice = { type: 'unsubscribed', budgetId, reason: 'REMOVED' };
      await expect(phone.next()).resolves.toEqual(notice);
      await expect(laptop.next()).resolves.toEqual(notice);
    });

    it('un expulsado sin suscripción a ese presupuesto no recibe aviso', async () => {
      const budgetId = await familyBudget();
      const idle = await subscribed(BEA);

      await api(ANA, 'DELETE', `/budgets/${budgetId}/members/${BEA.sub}`);

      await idle.expectSilence();
    });

    it('mantiene sus suscripciones a otros presupuestos', async () => {
      const budgetId = await familyBudget();
      const other = await seedBudget([
        { user: ANA, role: 'OWNER' },
        { user: BEA, role: 'VIEWER' },
      ]);
      const client = await subscribed(BEA, budgetId, other);

      await api(ANA, 'DELETE', `/budgets/${budgetId}/members/${BEA.sub}`);
      await expect(client.next()).resolves.toMatchObject({ type: 'unsubscribed', budgetId });
      await touchBudget(other);

      await expect(client.next()).resolves.toMatchObject({
        type: 'updated',
        budgetId: other,
      });
    });

    it('no puede volver a suscribirse, salvo que vuelva a ser miembro', async () => {
      const budgetId = await familyBudget();
      const client = await subscribed(BEA, budgetId);
      await api(ANA, 'DELETE', `/budgets/${budgetId}/members/${BEA.sub}`);
      await client.next();

      client.send({ type: 'subscribe', budgetId });
      await expect(client.next()).resolves.toEqual({
        type: 'error',
        code: 'NOT_FOUND',
        budgetId,
      });

      const invite = await api(ANA, 'POST', `/budgets/${budgetId}/invitations`, {});
      await api(BEA, 'POST', `/invitations/${invite.json().token}/accept`);
      client.send({ type: 'subscribe', budgetId });

      await expect(client.next()).resolves.toEqual({ type: 'subscribed', budgetId });
    });

    it('una expulsión rechazada (403) no saca a nadie', async () => {
      const budgetId = await familyBudget();
      const target = await subscribed(CARLOS, budgetId);

      const response = await api(BEA, 'DELETE', `/budgets/${budgetId}/members/${CARLOS.sub}`);

      expect(response.statusCode).toBe(403);
      await target.expectSilence();
    });
  });

  it('abandonar saca de la sala a las conexiones de quien se va', async () => {
    const budgetId = await familyBudget();
    const leaving = await subscribed(CARLOS, budgetId);
    const other = await subscribed(BEA, budgetId);

    await api(CARLOS, 'DELETE', `/budgets/${budgetId}/membership`);

    await expect(leaving.next()).resolves.toEqual({
      type: 'unsubscribed',
      budgetId,
      reason: 'LEFT',
    });
    await expect(other.next()).resolves.toMatchObject({ type: 'deleted', entity: 'member' });
    await touchBudget(budgetId);
    await leaving.expectSilence();
  });

  it('borrar el presupuesto avisa a todos y vacía la sala', async () => {
    const budgetId = await familyBudget();
    const member = await subscribed(CARLOS, budgetId);

    await api(ANA, 'DELETE', `/budgets/${budgetId}`);

    await expect(member.next()).resolves.toEqual({
      type: 'deleted',
      budgetId,
      entity: 'budget',
      id: budgetId,
    });
    await expect(member.next()).resolves.toEqual({
      type: 'unsubscribed',
      budgetId,
      reason: 'BUDGET_DELETED',
    });
    app.realtime.publish({ type: 'updated', budgetId, entity: 'budget', id: budgetId });
    await member.expectSilence();
  });

  describe('borrado de la cuenta', () => {
    it('cierra con 4403 todas las conexiones del usuario, también las sin suscripciones', async () => {
      const budgetId = await familyBudget();
      const subscribedSocket = await subscribed(BEA, budgetId);
      const idleSocket = await subscribed(BEA);
      const other = await subscribed(CARLOS, budgetId);

      await api(BEA, 'DELETE', '/me');

      await expect(subscribedSocket.closeCode()).resolves.toBe(4403);
      await expect(idleSocket.closeCode()).resolves.toBe(4403);
      expect(other.isOpen).toBe(true);
      await expect(other.next()).resolves.toMatchObject({
        type: 'deleted',
        entity: 'member',
        id: BEA.sub,
      });
    });

    it('no puede reconectar con el mismo token', async () => {
      await familyBudget();
      const headers = await authHeader(BEA);
      await subscribed(BEA);
      await api(BEA, 'DELETE', '/me');

      const error = await clients.connect(headers).then(
        () => null,
        (reason: unknown) => reason,
      );

      expect(error).toBeInstanceOf(HandshakeRejected);
      expect((error as HandshakeRejected).statusCode).toBe(401);
    });
  });

  describe('cambios que conservan la membresía', () => {
    it('cambiar de rol mantiene la suscripción', async () => {
      const budgetId = await familyBudget();
      const client = await subscribed(BEA, budgetId);

      await api(ANA, 'PATCH', `/budgets/${budgetId}/members/${BEA.sub}`, { role: 'VIEWER' });
      await expect(client.next()).resolves.toMatchObject({ type: 'updated', entity: 'member' });
      await touchBudget(budgetId);

      await expect(client.next()).resolves.toMatchObject({ type: 'updated', entity: 'budget' });
    });

    it('transferir la propiedad mantiene la suscripción de ambos', async () => {
      const budgetId = await familyBudget();
      const oldOwner = await subscribed(ANA, budgetId);
      const newOwner = await subscribed(BEA, budgetId);

      await api(ANA, 'POST', `/budgets/${budgetId}/ownership`, { userId: BEA.sub });

      await expect(oldOwner.next()).resolves.toMatchObject({ type: 'updated', entity: 'member' });
      await expect(newOwner.next()).resolves.toMatchObject({ type: 'updated', entity: 'member' });
      expect(oldOwner.isOpen).toBe(true);
    });
  });
});

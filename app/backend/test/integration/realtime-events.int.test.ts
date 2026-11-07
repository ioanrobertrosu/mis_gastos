import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { seedCategory, seedGoal, seedTransaction } from '../helpers/budget-data.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import {
  ANA,
  authHeader,
  BEA,
  CARLOS,
  DANI,
  seedBudget,
  seedUser,
  type TestUser,
} from '../helpers/users.js';
import { TestClients } from '../helpers/ws.js';

const BLOCKING_CONSTRAINT = 'activity_log_events_test_block';

let app: FastifyInstance;
let clients: TestClients;

beforeAll(async () => {
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
  await app.listen({ port: 0, host: '127.0.0.1' });
  clients = new TestClients(app);
});

afterEach(async () => {
  clients.closeAll();
  await testPrisma.$executeRawUnsafe(
    `ALTER TABLE "ActivityLog" DROP CONSTRAINT IF EXISTS "${BLOCKING_CONSTRAINT}"`,
  );
});

afterAll(async () => {
  await app.close();
});

async function api(
  user: TestUser,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

/** Conexión de `user` ya suscrita al presupuesto. */
async function subscribed(user: TestUser, budgetId: string) {
  const client = await clients.connect(await authHeader(user));
  client.send({ type: 'subscribe', budgetId });
  await expect(client.next()).resolves.toEqual({ type: 'subscribed', budgetId });
  return client;
}

describe('eventos tras una mutación', () => {
  describe('transacciones', () => {
    it('crear, editar y borrar notifican a los demás clientes', async () => {
      const budgetId = await familyBudget();
      const categoryId = await seedCategory(budgetId);
      const listener = await subscribed(CARLOS, budgetId);

      const created = await api(BEA, 'POST', `/budgets/${budgetId}/transactions`, {
        categoryId,
        amount: '12.50',
        date: '2026-10-15',
        description: 'Mercadona',
      });
      const id = created.json().id;
      await expect(listener.next()).resolves.toEqual({
        type: 'created',
        budgetId,
        entity: 'transaction',
        id,
      });

      await api(BEA, 'PATCH', `/budgets/${budgetId}/transactions/${id}`, { amount: '15' });
      await expect(listener.next()).resolves.toEqual({
        type: 'updated',
        budgetId,
        entity: 'transaction',
        id,
      });

      await api(BEA, 'DELETE', `/budgets/${budgetId}/transactions/${id}`);
      await expect(listener.next()).resolves.toEqual({
        type: 'deleted',
        budgetId,
        entity: 'transaction',
        id,
      });
    });
  });

  describe('categorías', () => {
    it('crear, editar y desactivar notifican', async () => {
      const budgetId = await familyBudget();
      const listener = await subscribed(CARLOS, budgetId);

      const created = await api(ANA, 'POST', `/budgets/${budgetId}/categories`, {
        name: 'Ocio',
        monthlyLimit: '50',
      });
      const id = created.json().id;
      await expect(listener.next()).resolves.toEqual({
        type: 'created',
        budgetId,
        entity: 'category',
        id,
      });

      await api(ANA, 'PATCH', `/budgets/${budgetId}/categories/${id}`, { monthlyLimit: '60' });
      await expect(listener.next()).resolves.toEqual({
        type: 'updated',
        budgetId,
        entity: 'category',
        id,
      });

      await api(ANA, 'DELETE', `/budgets/${budgetId}/categories/${id}`);
      await expect(listener.next()).resolves.toEqual({
        type: 'deleted',
        budgetId,
        entity: 'category',
        id,
      });
    });
  });

  describe('metas', () => {
    it('crear, editar, aportar y borrar notifican (aportar es un cambio de la meta)', async () => {
      const budgetId = await familyBudget();
      const listener = await subscribed(CARLOS, budgetId);

      const created = await api(BEA, 'POST', `/budgets/${budgetId}/goals`, {
        title: 'Viaje',
        targetAmount: '100',
      });
      const id = created.json().id;
      await expect(listener.next()).resolves.toEqual({
        type: 'created',
        budgetId,
        entity: 'goal',
        id,
      });

      await api(BEA, 'PATCH', `/budgets/${budgetId}/goals/${id}`, { title: 'Viaje a Roma' });
      await expect(listener.next()).resolves.toEqual({
        type: 'updated',
        budgetId,
        entity: 'goal',
        id,
      });

      await api(BEA, 'POST', `/budgets/${budgetId}/goals/${id}/contributions`, { amount: '5' });
      await expect(listener.next()).resolves.toEqual({
        type: 'updated',
        budgetId,
        entity: 'goal',
        id,
      });

      await api(BEA, 'DELETE', `/budgets/${budgetId}/goals/${id}`);
      await expect(listener.next()).resolves.toEqual({
        type: 'deleted',
        budgetId,
        entity: 'goal',
        id,
      });
    });
  });

  describe('presupuesto', () => {
    it('editarlo notifica', async () => {
      const budgetId = await familyBudget();
      const listener = await subscribed(CARLOS, budgetId);

      await api(ANA, 'PATCH', `/budgets/${budgetId}`, { name: 'Hogar' });

      await expect(listener.next()).resolves.toEqual({
        type: 'updated',
        budgetId,
        entity: 'budget',
        id: budgetId,
      });
    });

    it('borrarlo notifica', async () => {
      const budgetId = await familyBudget();
      const listener = await subscribed(CARLOS, budgetId);

      await api(ANA, 'DELETE', `/budgets/${budgetId}`);

      await expect(listener.next()).resolves.toEqual({
        type: 'deleted',
        budgetId,
        entity: 'budget',
        id: budgetId,
      });
    });
  });

  describe('miembros', () => {
    it('aceptar una invitación notifica el nuevo miembro', async () => {
      const budgetId = await familyBudget();
      await seedUser(DANI);
      const listener = await subscribed(CARLOS, budgetId);
      const invite = await api(ANA, 'POST', `/budgets/${budgetId}/invitations`, {});

      await api(DANI, 'POST', `/invitations/${invite.json().token}/accept`);

      await expect(listener.next()).resolves.toEqual({
        type: 'created',
        budgetId,
        entity: 'member',
        id: DANI.sub,
      });
    });

    it('cambiar un rol notifica', async () => {
      const budgetId = await familyBudget();
      const listener = await subscribed(CARLOS, budgetId);

      await api(ANA, 'PATCH', `/budgets/${budgetId}/members/${BEA.sub}`, { role: 'VIEWER' });

      await expect(listener.next()).resolves.toEqual({
        type: 'updated',
        budgetId,
        entity: 'member',
        id: BEA.sub,
      });
    });

    it('transferir la propiedad notifica el cambio del nuevo OWNER', async () => {
      const budgetId = await familyBudget();
      const listener = await subscribed(CARLOS, budgetId);

      await api(ANA, 'POST', `/budgets/${budgetId}/ownership`, { userId: BEA.sub });

      await expect(listener.next()).resolves.toEqual({
        type: 'updated',
        budgetId,
        entity: 'member',
        id: BEA.sub,
      });
    });

    it('expulsar notifica la baja del miembro', async () => {
      const budgetId = await familyBudget();
      const listener = await subscribed(CARLOS, budgetId);

      await api(ANA, 'DELETE', `/budgets/${budgetId}/members/${BEA.sub}`);

      await expect(listener.next()).resolves.toEqual({
        type: 'deleted',
        budgetId,
        entity: 'member',
        id: BEA.sub,
      });
    });

    it('abandonar notifica la baja del miembro', async () => {
      const budgetId = await familyBudget();
      const listener = await subscribed(CARLOS, budgetId);

      await api(BEA, 'DELETE', `/budgets/${budgetId}/membership`);

      await expect(listener.next()).resolves.toEqual({
        type: 'deleted',
        budgetId,
        entity: 'member',
        id: BEA.sub,
      });
    });

    it('borrar la cuenta notifica la baja en cada presupuesto compartido', async () => {
      const first = await familyBudget();
      const second = await seedBudget([
        { user: CARLOS, role: 'OWNER' },
        { user: ANA, role: 'VIEWER' },
      ]);
      const firstListener = await subscribed(CARLOS, first);
      const secondListener = await subscribed(CARLOS, second);

      await api(ANA, 'DELETE', '/me');

      await expect(firstListener.next()).resolves.toEqual({
        type: 'deleted',
        budgetId: first,
        entity: 'member',
        id: ANA.sub,
      });
      await expect(secondListener.next()).resolves.toEqual({
        type: 'deleted',
        budgetId: second,
        entity: 'member',
        id: ANA.sub,
      });
    });
  });
});

describe('a quién llegan los eventos', () => {
  it('a todas las conexiones suscritas, también a las del propio autor', async () => {
    const budgetId = await familyBudget();
    const viewer = await subscribed(CARLOS, budgetId);
    const author = await subscribed(ANA, budgetId);

    const response = await api(ANA, 'PATCH', `/budgets/${budgetId}`, { name: 'Hogar' });

    expect(response.statusCode).toBe(200);

    const event = { type: 'updated', budgetId, entity: 'budget', id: budgetId };
    await expect(viewer.next()).resolves.toEqual(event);
    await expect(author.next()).resolves.toEqual(event);
  });

  it('no llegan a quien no está suscrito', async () => {
    const budgetId = await familyBudget();
    const notSubscribed = await clients.connect(await authHeader(CARLOS));

    await api(ANA, 'PATCH', `/budgets/${budgetId}`, { name: 'Hogar' });

    await notSubscribed.expectSilence();
  });

  it('no llegan a los suscritos a otro presupuesto', async () => {
    const budgetId = await familyBudget();
    const other = await seedBudget([{ user: CARLOS, role: 'OWNER' }]);
    const listener = await subscribed(CARLOS, other);

    await api(ANA, 'PATCH', `/budgets/${budgetId}`, { name: 'Hogar' });

    await listener.expectSilence();
  });

  it('dejan de llegar tras cancelar la suscripción', async () => {
    const budgetId = await familyBudget();
    const listener = await subscribed(CARLOS, budgetId);
    listener.send({ type: 'unsubscribe', budgetId });
    await listener.next();

    await api(ANA, 'PATCH', `/budgets/${budgetId}`, { name: 'Hogar' });

    await listener.expectSilence();
  });

  it('un no miembro que intentó suscribirse no recibe nada', async () => {
    const budgetId = await familyBudget();
    const outsider = await clients.connect(await authHeader(DANI));
    outsider.send({ type: 'subscribe', budgetId });
    await expect(outsider.next()).resolves.toMatchObject({ type: 'error' });

    await api(ANA, 'PATCH', `/budgets/${budgetId}`, { name: 'Hogar' });

    await outsider.expectSilence();
  });

  it('una conexión cerrada no impide notificar a las demás', async () => {
    const budgetId = await familyBudget();
    const gone = await subscribed(BEA, budgetId);
    const listener = await subscribed(CARLOS, budgetId);
    gone.socket.terminate();

    const response = await api(ANA, 'PATCH', `/budgets/${budgetId}`, { name: 'Hogar' });

    expect(response.statusCode).toBe(200);
    await expect(listener.next()).resolves.toMatchObject({ type: 'updated' });
  });
});

describe('cuándo no hay evento', () => {
  it('las lecturas no notifican', async () => {
    const budgetId = await familyBudget();
    const listener = await subscribed(CARLOS, budgetId);

    await api(ANA, 'GET', `/budgets/${budgetId}/transactions`);

    await listener.expectSilence();
  });

  it('una petición rechazada no notifica', async () => {
    const budgetId = await familyBudget();
    const categoryId = await seedCategory(budgetId);
    const goalId = await seedGoal(budgetId, { status: 'ARCHIVED' });
    const listener = await subscribed(BEA, budgetId);

    await api(CARLOS, 'POST', `/budgets/${budgetId}/transactions`, {
      categoryId,
      amount: '10',
      date: '2026-10-15',
    });
    await api(ANA, 'POST', `/budgets/${budgetId}/transactions`, { categoryId });
    await api(ANA, 'POST', `/budgets/${budgetId}/goals/${goalId}/contributions`, { amount: '1' });

    await listener.expectSilence();
  });

  it('si la transacción de BD falla, no hay evento', async () => {
    const budgetId = await familyBudget();
    const categoryId = await seedCategory(budgetId);
    const listener = await subscribed(CARLOS, budgetId);
    await testPrisma.$executeRawUnsafe(
      `ALTER TABLE "ActivityLog" ADD CONSTRAINT "${BLOCKING_CONSTRAINT}" CHECK ("action" <> 'TRANSACTION_CREATED')`,
    );

    const response = await api(ANA, 'POST', `/budgets/${budgetId}/transactions`, {
      categoryId,
      amount: '10',
      date: '2026-10-15',
    });

    expect(response.statusCode).toBe(500);
    await listener.expectSilence();
  });

  it('el evento llega con los datos ya confirmados', async () => {
    const budgetId = await familyBudget();
    const categoryId = await seedCategory(budgetId);
    const id = await seedTransaction(budgetId, categoryId, { createdBy: ANA, amount: '10.00' });
    const listener = await subscribed(CARLOS, budgetId);

    await api(ANA, 'PATCH', `/budgets/${budgetId}/transactions/${id}`, { amount: '20' });
    await listener.next();

    const read = await api(CARLOS, 'GET', `/budgets/${budgetId}/transactions/${id}`);
    expect(read.json()).toMatchObject({ amount: '20.00' });
  });
});

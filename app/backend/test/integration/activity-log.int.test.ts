import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { seedCategory, seedGoal, seedTransaction, storedGoal } from '../helpers/budget-data.js';
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

const BLOCKING_CONSTRAINT = 'activity_log_test_block';

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
});

afterEach(async () => {
  await testPrisma.$executeRawUnsafe(
    `ALTER TABLE "ActivityLog" DROP CONSTRAINT IF EXISTS "${BLOCKING_CONSTRAINT}"`,
  );
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

/** Actividad del presupuesto en orden de registro. */
async function activities(budgetId: string) {
  return testPrisma.activityLog.findMany({
    where: { budgetId },
    orderBy: { seq: 'asc' },
    select: { action: true, userId: true, metadata: true },
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

/** Hace que la BD rechace el registro de una acción concreta (simula un fallo al registrarla). */
async function blockActivity(action: string) {
  await testPrisma.$executeRawUnsafe(
    `ALTER TABLE "ActivityLog" ADD CONSTRAINT "${BLOCKING_CONSTRAINT}" CHECK ("action" <> '${action}')`,
  );
}

describe('registro de actividad', () => {
  describe('presupuesto', () => {
    it('crear un presupuesto registra BUDGET_CREATED', async () => {
      await seedUser(ANA);

      const response = await api(ANA, 'POST', '/budgets', { name: 'Casa' });

      await expect(activities(response.json().id)).resolves.toEqual([
        { action: 'BUDGET_CREATED', userId: ANA.sub, metadata: { name: 'Casa' } },
      ]);
    });

    it('editarlo registra BUDGET_UPDATED solo con los campos que cambian', async () => {
      const id = await familyBudget();
      await testPrisma.budget.update({ where: { id }, data: { name: 'Casa' } });

      await api(ANA, 'PATCH', `/budgets/${id}`, { name: 'Hogar', currency: 'EUR' });

      await expect(activities(id)).resolves.toEqual([
        {
          action: 'BUDGET_UPDATED',
          userId: ANA.sub,
          metadata: { changes: { name: { from: 'Casa', to: 'Hogar' } } },
        },
      ]);
    });

    it('una edición sin cambios reales no registra nada', async () => {
      const id = await familyBudget();
      await testPrisma.budget.update({ where: { id }, data: { name: 'Casa' } });

      await api(ANA, 'PATCH', `/budgets/${id}`, { name: 'Casa' });

      await expect(activities(id)).resolves.toEqual([]);
    });
  });

  describe('miembros', () => {
    it('aceptar una invitación registra MEMBER_JOINED (autor: quien se une)', async () => {
      const id = await seedBudget([{ user: ANA, role: 'OWNER' }]);
      await seedUser(DANI);
      const invite = await api(ANA, 'POST', `/budgets/${id}/invitations`, { role: 'EDITOR' });
      await testPrisma.activityLog.deleteMany();

      await api(DANI, 'POST', `/invitations/${invite.json().token}/accept`);

      await expect(activities(id)).resolves.toEqual([
        {
          action: 'MEMBER_JOINED',
          userId: DANI.sub,
          metadata: { userId: DANI.sub, role: 'EDITOR' },
        },
      ]);
    });

    it('cambiar un rol registra MEMBER_ROLE_CHANGED', async () => {
      const id = await familyBudget();

      await api(ANA, 'PATCH', `/budgets/${id}/members/${CARLOS.sub}`, { role: 'EDITOR' });

      await expect(activities(id)).resolves.toEqual([
        {
          action: 'MEMBER_ROLE_CHANGED',
          userId: ANA.sub,
          metadata: { userId: CARLOS.sub, from: 'VIEWER', to: 'EDITOR' },
        },
      ]);
    });

    it('expulsar registra MEMBER_REMOVED', async () => {
      const id = await familyBudget();

      await api(ANA, 'DELETE', `/budgets/${id}/members/${BEA.sub}`);

      await expect(activities(id)).resolves.toEqual([
        { action: 'MEMBER_REMOVED', userId: ANA.sub, metadata: { userId: BEA.sub } },
      ]);
    });

    it('abandonar registra MEMBER_LEFT (autor: quien se va)', async () => {
      const id = await familyBudget();

      await api(CARLOS, 'DELETE', `/budgets/${id}/membership`);

      await expect(activities(id)).resolves.toEqual([
        { action: 'MEMBER_LEFT', userId: CARLOS.sub, metadata: { userId: CARLOS.sub } },
      ]);
    });

    it('transferir la propiedad registra OWNERSHIP_TRANSFERRED', async () => {
      const id = await familyBudget();

      await api(ANA, 'POST', `/budgets/${id}/ownership`, { userId: BEA.sub });

      await expect(activities(id)).resolves.toEqual([
        {
          action: 'OWNERSHIP_TRANSFERRED',
          userId: ANA.sub,
          metadata: { from: ANA.sub, to: BEA.sub },
        },
      ]);
    });

    it('borrar la cuenta registra la transferencia automática y la salida', async () => {
      const owned = await familyBudget();
      const joined = await seedBudget([
        { user: BEA, role: 'OWNER' },
        { user: ANA, role: 'EDITOR' },
      ]);

      await api(ANA, 'DELETE', '/me');

      await expect(activities(owned)).resolves.toEqual([
        {
          action: 'OWNERSHIP_TRANSFERRED',
          userId: ANA.sub,
          metadata: { from: ANA.sub, to: BEA.sub, reason: 'ACCOUNT_DELETED' },
        },
        {
          action: 'MEMBER_LEFT',
          userId: ANA.sub,
          metadata: { userId: ANA.sub, reason: 'ACCOUNT_DELETED' },
        },
      ]);
      await expect(activities(joined)).resolves.toEqual([
        {
          action: 'MEMBER_LEFT',
          userId: ANA.sub,
          metadata: { userId: ANA.sub, reason: 'ACCOUNT_DELETED' },
        },
      ]);
    });
  });

  describe('categorías', () => {
    it('crear registra CATEGORY_CREATED', async () => {
      const id = await familyBudget();

      const response = await api(ANA, 'POST', `/budgets/${id}/categories`, {
        name: 'Comida',
        monthlyLimit: '250',
      });

      await expect(activities(id)).resolves.toEqual([
        {
          action: 'CATEGORY_CREATED',
          userId: ANA.sub,
          metadata: { categoryId: response.json().id, name: 'Comida', monthlyLimit: '250.00' },
        },
      ]);
    });

    it('cambiar el límite registra CATEGORY_LIMIT_UPDATED; otros campos, CATEGORY_UPDATED', async () => {
      const id = await familyBudget();
      const categoryId = await seedCategory(id, { name: 'Comida', monthlyLimit: '300.00' });

      await api(ANA, 'PATCH', `/budgets/${id}/categories/${categoryId}`, { monthlyLimit: '350' });
      await api(ANA, 'PATCH', `/budgets/${id}/categories/${categoryId}`, { name: 'Súper' });

      await expect(activities(id)).resolves.toEqual([
        {
          action: 'CATEGORY_LIMIT_UPDATED',
          userId: ANA.sub,
          metadata: {
            categoryId,
            name: 'Comida',
            changes: { monthlyLimit: { from: '300.00', to: '350.00' } },
          },
        },
        {
          action: 'CATEGORY_UPDATED',
          userId: ANA.sub,
          metadata: {
            categoryId,
            name: 'Súper',
            changes: { name: { from: 'Comida', to: 'Súper' } },
          },
        },
      ]);
    });

    it('desactivar registra CATEGORY_DEACTIVATED una sola vez; reactivar, CATEGORY_REACTIVATED', async () => {
      const id = await familyBudget();
      const categoryId = await seedCategory(id, { name: 'Ocio' });

      await api(ANA, 'DELETE', `/budgets/${id}/categories/${categoryId}`);
      await api(ANA, 'DELETE', `/budgets/${id}/categories/${categoryId}`);
      await api(ANA, 'PATCH', `/budgets/${id}/categories/${categoryId}`, { isActive: true });

      await expect(activities(id)).resolves.toEqual([
        { action: 'CATEGORY_DEACTIVATED', userId: ANA.sub, metadata: { categoryId, name: 'Ocio' } },
        { action: 'CATEGORY_REACTIVATED', userId: ANA.sub, metadata: { categoryId, name: 'Ocio' } },
      ]);
    });

    it('una edición sin cambios reales no registra nada', async () => {
      const id = await familyBudget();
      const categoryId = await seedCategory(id, { name: 'Ocio', monthlyLimit: '100.00' });

      await api(ANA, 'PATCH', `/budgets/${id}/categories/${categoryId}`, {
        name: 'Ocio',
        monthlyLimit: '100',
      });

      await expect(activities(id)).resolves.toEqual([]);
    });
  });

  describe('transacciones', () => {
    it('crear, editar y borrar registran su actividad', async () => {
      const id = await familyBudget();
      const categoryId = await seedCategory(id);

      const created = await api(BEA, 'POST', `/budgets/${id}/transactions`, {
        categoryId,
        amount: '12.5',
        date: '2026-10-15',
      });
      const transactionId = created.json().id;
      await api(BEA, 'PATCH', `/budgets/${id}/transactions/${transactionId}`, { amount: '15' });
      await api(ANA, 'DELETE', `/budgets/${id}/transactions/${transactionId}`);

      await expect(activities(id)).resolves.toEqual([
        {
          action: 'TRANSACTION_CREATED',
          userId: BEA.sub,
          metadata: { transactionId, categoryId, amount: '12.50' },
        },
        {
          action: 'TRANSACTION_UPDATED',
          userId: BEA.sub,
          metadata: { transactionId, changes: { amount: { from: '12.50', to: '15.00' } } },
        },
        {
          action: 'TRANSACTION_DELETED',
          userId: ANA.sub,
          metadata: { transactionId, categoryId, amount: '15.00' },
        },
      ]);
    });

    it('una petición rechazada (409 o 403) no registra nada', async () => {
      const id = await familyBudget();
      const inactive = await seedCategory(id, { isActive: false });
      const categoryId = await seedCategory(id);

      await api(ANA, 'POST', `/budgets/${id}/transactions`, {
        categoryId: inactive,
        amount: '10',
        date: '2026-10-15',
      });
      await api(CARLOS, 'POST', `/budgets/${id}/transactions`, {
        categoryId,
        amount: '10',
        date: '2026-10-15',
      });

      await expect(activities(id)).resolves.toEqual([]);
    });
  });

  describe('metas', () => {
    it('crear, editar, archivar y borrar registran su actividad', async () => {
      const id = await familyBudget();

      const created = await api(BEA, 'POST', `/budgets/${id}/goals`, {
        title: 'Viaje',
        targetAmount: '1000',
      });
      const goalId = created.json().id;
      await api(BEA, 'PATCH', `/budgets/${id}/goals/${goalId}`, { title: 'Viaje a Roma' });
      await api(ANA, 'PATCH', `/budgets/${id}/goals/${goalId}`, { archived: true });
      await api(ANA, 'DELETE', `/budgets/${id}/goals/${goalId}`);

      await expect(activities(id)).resolves.toEqual([
        {
          action: 'GOAL_CREATED',
          userId: BEA.sub,
          metadata: { goalId, title: 'Viaje', targetAmount: '1000.00' },
        },
        {
          action: 'GOAL_UPDATED',
          userId: BEA.sub,
          metadata: {
            goalId,
            title: 'Viaje a Roma',
            changes: { title: { from: 'Viaje', to: 'Viaje a Roma' } },
          },
        },
        { action: 'GOAL_ARCHIVED', userId: ANA.sub, metadata: { goalId, title: 'Viaje a Roma' } },
        { action: 'GOAL_DELETED', userId: ANA.sub, metadata: { goalId, title: 'Viaje a Roma' } },
      ]);
    });

    it('aportar registra GOAL_CONTRIBUTION y, al alcanzar el objetivo, GOAL_REACHED una sola vez', async () => {
      const id = await familyBudget();
      const goalId = await seedGoal(id, {
        title: 'Colchón',
        targetAmount: '100.00',
        currentAmount: '90.00',
      });

      const first = await api(BEA, 'POST', `/budgets/${id}/goals/${goalId}/contributions`, {
        amount: '10',
      });
      const second = await api(ANA, 'POST', `/budgets/${id}/goals/${goalId}/contributions`, {
        amount: '5',
      });

      await expect(activities(id)).resolves.toEqual([
        {
          action: 'GOAL_CONTRIBUTION',
          userId: BEA.sub,
          metadata: {
            goalId,
            title: 'Colchón',
            contributionId: first.json().contribution.id,
            amount: '10.00',
          },
        },
        { action: 'GOAL_REACHED', userId: BEA.sub, metadata: { goalId, title: 'Colchón' } },
        {
          action: 'GOAL_CONTRIBUTION',
          userId: ANA.sub,
          metadata: {
            goalId,
            title: 'Colchón',
            contributionId: second.json().contribution.id,
            amount: '5.00',
          },
        },
      ]);
    });

    it('bajar el objetivo hasta lo ahorrado también registra GOAL_REACHED', async () => {
      const id = await familyBudget();
      const goalId = await seedGoal(id, {
        title: 'Coche',
        targetAmount: '500.00',
        currentAmount: '300.00',
      });

      await api(ANA, 'PATCH', `/budgets/${id}/goals/${goalId}`, { targetAmount: '300' });

      await expect(activities(id)).resolves.toEqual([
        {
          action: 'GOAL_UPDATED',
          userId: ANA.sub,
          metadata: {
            goalId,
            title: 'Coche',
            changes: { targetAmount: { from: '500.00', to: '300.00' } },
          },
        },
        { action: 'GOAL_REACHED', userId: ANA.sub, metadata: { goalId, title: 'Coche' } },
      ]);
    });
  });

  describe('atomicidad: actividad y mutación en la misma transacción', () => {
    it('si no se puede registrar la actividad, la transacción tampoco se crea', async () => {
      const id = await familyBudget();
      const categoryId = await seedCategory(id);
      await blockActivity('TRANSACTION_CREATED');

      const response = await api(ANA, 'POST', `/budgets/${id}/transactions`, {
        categoryId,
        amount: '10',
        date: '2026-10-15',
      });

      expect(response.statusCode).toBe(500);
      await expect(testPrisma.transaction.count({ where: { budgetId: id } })).resolves.toBe(0);
    });

    it('si no se puede registrar la aportación, la meta no se modifica', async () => {
      const id = await familyBudget();
      const goalId = await seedGoal(id, { currentAmount: '20.00' });
      await blockActivity('GOAL_CONTRIBUTION');

      const response = await api(ANA, 'POST', `/budgets/${id}/goals/${goalId}/contributions`, {
        amount: '10',
      });

      expect(response.statusCode).toBe(500);
      await expect(storedGoal(goalId)).resolves.toMatchObject({ currentAmount: '20.00' });
      await expect(testPrisma.goalContribution.count({ where: { goalId } })).resolves.toBe(0);
    });

    it('si no se puede registrar el borrado, la transacción sigue existiendo', async () => {
      const id = await familyBudget();
      const transactionId = await seedTransaction(id, await seedCategory(id), { createdBy: ANA });
      await blockActivity('TRANSACTION_DELETED');

      const response = await api(ANA, 'DELETE', `/budgets/${id}/transactions/${transactionId}`);

      expect(response.statusCode).toBe(500);
      await expect(testPrisma.transaction.count({ where: { id: transactionId } })).resolves.toBe(1);
    });
  });
});

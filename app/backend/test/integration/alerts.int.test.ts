import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { evaluateCategoryAlerts } from '../../src/modules/activity/alerts.service.js';
import { seedCategory, seedGoal, seedTransaction } from '../helpers/budget-data.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import { ANA, authHeader, BEA, seedBudget, seedUser, type TestUser } from '../helpers/users.js';

const BLOCKING_CONSTRAINT = 'activity_log_alert_test_block';

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
  method: 'GET' | 'POST' | 'PATCH',
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

function spend(budgetId: string, categoryId: string, amount: string, date = '2026-10-15') {
  return api(BEA, 'POST', `/budgets/${budgetId}/transactions`, { categoryId, amount, date });
}

/** Alertas de categoría del presupuesto, en orden de registro. */
async function alerts(budgetId: string) {
  return testPrisma.activityLog.findMany({
    where: { budgetId, action: { in: ['CATEGORY_90_PERCENT', 'CATEGORY_LIMIT_EXCEEDED'] } },
    orderBy: { seq: 'asc' },
    select: { action: true, userId: true, metadata: true },
  });
}

async function alertActions(budgetId: string) {
  return (await alerts(budgetId)).map(({ action }) => action);
}

/** ANA (OWNER) y BEA (EDITOR), con una categoría de límite 100. */
async function budget() {
  const budgetId = await seedBudget([
    { user: ANA, role: 'OWNER' },
    { user: BEA, role: 'EDITOR' },
  ]);
  const categoryId = await seedCategory(budgetId, { name: 'Comida', monthlyLimit: '100.00' });
  return { budgetId, categoryId };
}

describe('alerta CATEGORY_90_PERCENT', () => {
  it('se genera al llegar al 90 % del límite, no antes', async () => {
    const { budgetId, categoryId } = await budget();

    await spend(budgetId, categoryId, '89.99');
    await expect(alerts(budgetId)).resolves.toEqual([]);

    await spend(budgetId, categoryId, '0.01');

    await expect(alerts(budgetId)).resolves.toEqual([
      {
        action: 'CATEGORY_90_PERCENT',
        userId: BEA.sub,
        metadata: {
          categoryId,
          name: 'Comida',
          month: '2026-10',
          spent: '90.00',
          monthlyLimit: '100.00',
          percentUsed: 90,
        },
      },
    ]);
  });

  it('solo se genera una vez por mes y categoría, aunque el gasto baje y vuelva a subir', async () => {
    const { budgetId, categoryId } = await budget();
    const first = await spend(budgetId, categoryId, '90');
    await spend(budgetId, categoryId, '5');
    await api(BEA, 'PATCH', `/budgets/${budgetId}/transactions/${first.json().id}`, {
      amount: '10',
    });
    await api(BEA, 'PATCH', `/budgets/${budgetId}/transactions/${first.json().id}`, {
      amount: '91',
    });

    await expect(alertActions(budgetId)).resolves.toEqual(['CATEGORY_90_PERCENT']);
  });

  it('cada mes y cada categoría tienen su propia alerta', async () => {
    const { budgetId, categoryId } = await budget();
    const ocio = await seedCategory(budgetId, { name: 'Ocio', monthlyLimit: '50.00' });

    await spend(budgetId, categoryId, '90', '2026-10-15');
    await spend(budgetId, categoryId, '90', '2026-11-15');
    await spend(budgetId, ocio, '45', '2026-10-15');

    const entries = await alerts(budgetId);
    expect(entries.map(({ metadata }) => metadata)).toEqual([
      expect.objectContaining({ categoryId, month: '2026-10' }),
      expect.objectContaining({ categoryId, month: '2026-11' }),
      expect.objectContaining({ categoryId: ocio, month: '2026-10' }),
    ]);
  });

  it('el gasto se mide en el mes de la transacción, no en el actual', async () => {
    const { budgetId, categoryId } = await budget();
    await seedTransaction(budgetId, categoryId, { amount: '80.00', date: '2026-09-30' });

    await spend(budgetId, categoryId, '15', '2026-10-01');
    await expect(alerts(budgetId)).resolves.toEqual([]);

    await spend(budgetId, categoryId, '10', '2026-09-01');

    await expect(alerts(budgetId)).resolves.toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ month: '2026-09', spent: '90.00' }),
      }),
    ]);
  });

  it('una categoría con límite 0 no genera alertas', async () => {
    const { budgetId } = await budget();
    const sinLimite = await seedCategory(budgetId, { name: 'Sin límite', monthlyLimit: '0.00' });

    await spend(budgetId, sinLimite, '500');

    await expect(alerts(budgetId)).resolves.toEqual([]);
  });
});

describe('alerta CATEGORY_LIMIT_EXCEEDED', () => {
  it('llegar exactamente al 100 % no excede; superarlo sí, una sola vez', async () => {
    const { budgetId, categoryId } = await budget();

    await spend(budgetId, categoryId, '100');
    await expect(alertActions(budgetId)).resolves.toEqual(['CATEGORY_90_PERCENT']);

    await spend(budgetId, categoryId, '0.01');
    await spend(budgetId, categoryId, '50');

    await expect(alertActions(budgetId)).resolves.toEqual([
      'CATEGORY_90_PERCENT',
      'CATEGORY_LIMIT_EXCEEDED',
    ]);
  });

  it('un salto directo por encima del límite genera solo la alerta de exceso', async () => {
    const { budgetId, categoryId } = await budget();

    await spend(budgetId, categoryId, '120');

    await expect(alerts(budgetId)).resolves.toEqual([
      {
        action: 'CATEGORY_LIMIT_EXCEEDED',
        userId: BEA.sub,
        metadata: {
          categoryId,
          name: 'Comida',
          month: '2026-10',
          spent: '120.00',
          monthlyLimit: '100.00',
          percentUsed: 120,
        },
      },
    ]);
  });
});

describe('qué cambios evalúan las alertas', () => {
  it('editar el importe de una transacción', async () => {
    const { budgetId, categoryId } = await budget();
    const id = (await spend(budgetId, categoryId, '10')).json().id;

    await api(BEA, 'PATCH', `/budgets/${budgetId}/transactions/${id}`, { amount: '95' });

    await expect(alertActions(budgetId)).resolves.toEqual(['CATEGORY_90_PERCENT']);
  });

  it('mover una transacción: se evalúan la categoría y el mes de destino', async () => {
    const { budgetId, categoryId } = await budget();
    const ocio = await seedCategory(budgetId, { name: 'Ocio', monthlyLimit: '50.00' });
    const id = (await spend(budgetId, categoryId, '60')).json().id;

    await api(BEA, 'PATCH', `/budgets/${budgetId}/transactions/${id}`, {
      categoryId: ocio,
      date: '2026-11-02',
    });

    await expect(alerts(budgetId)).resolves.toEqual([
      expect.objectContaining({
        action: 'CATEGORY_LIMIT_EXCEEDED',
        metadata: expect.objectContaining({ categoryId: ocio, month: '2026-11', spent: '60.00' }),
      }),
    ]);
  });

  it('bajar el límite evalúa el mes actual (UTC); subirlo no genera nada', async () => {
    const { budgetId, categoryId } = await budget();
    const today = new Date().toISOString().slice(0, 10);
    await seedTransaction(budgetId, categoryId, { amount: '50.00', date: today });

    await api(ANA, 'PATCH', `/budgets/${budgetId}/categories/${categoryId}`, {
      monthlyLimit: '200',
    });
    await expect(alerts(budgetId)).resolves.toEqual([]);

    await api(ANA, 'PATCH', `/budgets/${budgetId}/categories/${categoryId}`, {
      monthlyLimit: '40',
    });

    await expect(alerts(budgetId)).resolves.toEqual([
      {
        action: 'CATEGORY_LIMIT_EXCEEDED',
        userId: ANA.sub,
        metadata: {
          categoryId,
          name: 'Comida',
          month: today.slice(0, 7),
          spent: '50.00',
          monthlyLimit: '40.00',
          percentUsed: 125,
        },
      },
    ]);
  });
});

describe('concurrencia y atomicidad', () => {
  it('gastos simultáneos que cruzan el 90 % generan exactamente una alerta', async () => {
    const { budgetId, categoryId } = await budget();
    await seedTransaction(budgetId, categoryId, { amount: '80.00' });

    const responses = await Promise.all(
      Array.from({ length: 4 }, () => spend(budgetId, categoryId, '5')),
    );

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201, 201, 201]);
    await expect(alertActions(budgetId)).resolves.toEqual(['CATEGORY_90_PERCENT']);
  });

  it('un gasto espera a que se confirme otro simultáneo para no perder la alerta', async () => {
    const { budgetId, categoryId } = await budget();
    await seedTransaction(budgetId, categoryId, { amount: '80.00' });
    let request: ReturnType<typeof spend> | undefined;

    // Transacción abierta que suma 85 (sin alerta) y no se confirma hasta que la petición, que
    // aporta los 5 restantes, termine o quede claramente bloqueada.
    await testPrisma.$transaction(
      async (tx) => {
        await tx.transaction.create({
          data: { budgetId, categoryId, amount: '5.00', date: new Date('2026-10-15') },
        });
        await evaluateCategoryAlerts(tx, {
          budgetId,
          categoryId,
          userId: ANA.sub,
          month: '2026-10',
        });

        request = spend(budgetId, categoryId, '5');
        await Promise.race([request, new Promise((resolve) => setTimeout(resolve, 4_000))]);
      },
      { maxWait: 10_000, timeout: 15_000 },
    );

    expect((await request)?.statusCode).toBe(201);
    await expect(alertActions(budgetId)).resolves.toEqual(['CATEGORY_90_PERCENT']);
  }, 30_000);

  it('si no se puede registrar la alerta, el gasto tampoco se crea', async () => {
    const { budgetId, categoryId } = await budget();
    await testPrisma.$executeRawUnsafe(
      `ALTER TABLE "ActivityLog" ADD CONSTRAINT "${BLOCKING_CONSTRAINT}" CHECK ("action" <> 'CATEGORY_90_PERCENT')`,
    );

    const response = await spend(budgetId, categoryId, '95');

    expect(response.statusCode).toBe(500);
    await expect(testPrisma.transaction.count({ where: { budgetId } })).resolves.toBe(0);
  });
});

describe('hitos en el muro de actividad', () => {
  it('las alertas de categoría, la meta alcanzada y el nuevo miembro aparecen en el muro', async () => {
    const { budgetId, categoryId } = await budget();
    await spend(budgetId, categoryId, '95');
    const goalId = await seedGoal(budgetId, { targetAmount: '10.00' });
    await api(BEA, 'POST', `/budgets/${budgetId}/goals/${goalId}/contributions`, { amount: '10' });
    await seedUser({ sub: '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d', email: 'nueva@example.com' });
    const invite = await api(ANA, 'POST', `/budgets/${budgetId}/invitations`, {});
    expect(invite.statusCode).toBe(201);
    await api(
      { sub: '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d', email: 'nueva@example.com' },
      'POST',
      `/invitations/${invite.json().token}/accept`,
    );

    const response = await api(ANA, 'GET', `/budgets/${budgetId}/activity`);

    const actions = response.json().items.map(({ action }: { action: string }) => action);
    expect(actions).toEqual(
      expect.arrayContaining(['CATEGORY_90_PERCENT', 'GOAL_REACHED', 'MEMBER_JOINED']),
    );
  });
});

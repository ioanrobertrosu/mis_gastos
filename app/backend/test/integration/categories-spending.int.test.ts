import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { seedCategory, seedTransaction } from '../helpers/budget-data.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import { ANA, authHeader, BEA, CARLOS, seedBudget } from '../helpers/users.js';

interface CategoryItem {
  id: string;
  name: string;
  spent: string;
  percentUsed: number | null;
}

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
});

async function list(budgetId: string, query = '') {
  return app.inject({
    method: 'GET',
    url: `/api/v1/budgets/${budgetId}/categories${query ? `?${query}` : ''}`,
    headers: await authHeader(CARLOS),
  });
}

async function categories(budgetId: string, query = ''): Promise<CategoryItem[]> {
  const response = await list(budgetId, query);
  expect(response.statusCode).toBe(200);
  return response.json();
}

function byName(items: CategoryItem[], name: string) {
  return items.find((item) => item.name === name);
}

/** ANA (OWNER) y CARLOS (VIEWER). */
async function budget() {
  return seedBudget([
    { user: ANA, role: 'OWNER' },
    { user: CARLOS, role: 'VIEWER' },
  ]);
}

describe('GET /api/v1/budgets/:id/categories — gasto del mes', () => {
  it('suma solo las transacciones de cada categoría en el mes pedido', async () => {
    const id = await budget();
    const comida = await seedCategory(id, { name: 'Comida', monthlyLimit: '300.00' });
    const ocio = await seedCategory(id, { name: 'Ocio', monthlyLimit: '100.00' });
    await seedTransaction(id, comida, { amount: '45.10', date: '2026-10-01' });
    await seedTransaction(id, comida, { amount: '54.90', date: '2026-10-31' });
    await seedTransaction(id, comida, { amount: '999.00', date: '2026-09-30' });
    await seedTransaction(id, comida, { amount: '999.00', date: '2026-11-01' });
    await seedTransaction(id, ocio, { amount: '25.00', date: '2026-10-15' });

    const items = await categories(id, 'month=2026-10');

    expect(byName(items, 'Comida')).toMatchObject({ spent: '100.00', percentUsed: 33.3 });
    expect(byName(items, 'Ocio')).toMatchObject({ spent: '25.00', percentUsed: 25 });
  });

  it('una categoría sin gastos tiene spent "0.00" y percentUsed 0', async () => {
    const id = await budget();
    await seedCategory(id, { name: 'Vacía', monthlyLimit: '50.00' });

    const items = await categories(id, 'month=2026-10');

    expect(byName(items, 'Vacía')).toMatchObject({ spent: '0.00', percentUsed: 0 });
  });

  it('con límite 0 el porcentaje es null aunque haya gasto', async () => {
    const id = await budget();
    const sinLimite = await seedCategory(id, { name: 'Sin límite', monthlyLimit: '0.00' });
    await seedTransaction(id, sinLimite, { amount: '10.00', date: '2026-10-05' });

    const items = await categories(id, 'month=2026-10');

    expect(byName(items, 'Sin límite')).toMatchObject({ spent: '10.00', percentUsed: null });
  });

  it('el porcentaje supera 100 cuando se excede el límite', async () => {
    const id = await budget();
    const ocio = await seedCategory(id, { name: 'Ocio', monthlyLimit: '80.00' });
    await seedTransaction(id, ocio, { amount: '120.00', date: '2026-10-05' });

    const items = await categories(id, 'month=2026-10');

    expect(byName(items, 'Ocio')).toMatchObject({ spent: '120.00', percentUsed: 150 });
  });

  it('el gasto es exacto en decimal (sin coma flotante)', async () => {
    const id = await budget();
    const comida = await seedCategory(id, { name: 'Comida', monthlyLimit: '1.00' });
    await seedTransaction(id, comida, { amount: '0.10', date: '2026-10-01' });
    await seedTransaction(id, comida, { amount: '0.20', date: '2026-10-02' });

    const items = await categories(id, 'month=2026-10');

    expect(byName(items, 'Comida')).toMatchObject({ spent: '0.30', percentUsed: 30 });
  });

  it('sin month usa el mes actual (UTC)', async () => {
    const id = await budget();
    const comida = await seedCategory(id, { name: 'Comida', monthlyLimit: '100.00' });
    const today = new Date().toISOString().slice(0, 10);
    await seedTransaction(id, comida, { amount: '12.00', date: today });

    const items = await categories(id);

    expect(byName(items, 'Comida')).toMatchObject({ spent: '12.00', percentUsed: 12 });
  });

  it('las categorías inactivas (includeInactive) también traen su gasto', async () => {
    const id = await budget();
    const antigua = await seedCategory(id, {
      name: 'Antigua',
      monthlyLimit: '10.00',
      isActive: false,
    });
    await seedTransaction(id, antigua, { amount: '5.00', date: '2026-10-05' });

    const items = await categories(id, 'month=2026-10&includeInactive=true');

    expect(byName(items, 'Antigua')).toMatchObject({ spent: '5.00', percentUsed: 50 });
  });

  it('no mezcla el gasto de otros presupuestos', async () => {
    const id = await budget();
    await seedCategory(id, { name: 'Comida', monthlyLimit: '100.00' });
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedCategory(other, { name: 'Comida' });
    await seedTransaction(other, foreign, { amount: '50.00', date: '2026-10-05' });

    const items = await categories(id, 'month=2026-10');

    expect(items).toHaveLength(1);
    expect(byName(items, 'Comida')).toMatchObject({ spent: '0.00' });
  });

  it.each([
    ['mes 13', 'month=2026-13'],
    ['mes 00', 'month=2026-00'],
    ['mes sin cero', 'month=2026-1'],
    ['fecha completa', 'month=2026-10-01'],
    ['texto', 'month=octubre'],
  ])('rechaza con 400: %s', async (_case, query) => {
    const id = await budget();

    const response = await list(id, query);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});

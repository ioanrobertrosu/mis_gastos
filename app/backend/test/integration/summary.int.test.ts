import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { seedCategory, seedTransaction } from '../helpers/budget-data.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import { ANA, authHeader, BEA, CARLOS, seedBudget, type TestUser } from '../helpers/users.js';

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
});

async function summary(user: TestUser, budgetId: string, query = '') {
  return app.inject({
    method: 'GET',
    url: `/api/v1/budgets/${budgetId}/summary${query ? `?${query}` : ''}`,
    headers: await authHeader(user),
  });
}

/** ANA (OWNER) y CARLOS (VIEWER). */
async function budget() {
  return seedBudget([
    { user: ANA, role: 'OWNER' },
    { user: CARLOS, role: 'VIEWER' },
  ]);
}

describe('GET /api/v1/budgets/:id/summary', () => {
  it('devuelve asignado, gastado y restante del mes (base cero)', async () => {
    const id = await budget();
    const comida = await seedCategory(id, { name: 'Comida', monthlyLimit: '300.00' });
    const ocio = await seedCategory(id, { name: 'Ocio', monthlyLimit: '100.00' });
    await seedTransaction(id, comida, { amount: '80.25', date: '2026-10-01' });
    await seedTransaction(id, ocio, { amount: '40.25', date: '2026-10-31' });
    // Fuera del mes.
    await seedTransaction(id, comida, { amount: '500.00', date: '2026-09-30' });
    await seedTransaction(id, comida, { amount: '500.00', date: '2026-11-01' });

    const response = await summary(CARLOS, id, 'month=2026-10');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      month: '2026-10',
      currency: 'EUR',
      allocated: '400.00',
      spent: '120.50',
      remaining: '279.50',
      percentUsed: 30.1,
    });
  });

  it('el asignado solo cuenta categorías activas; el gasto de una desactivada sí cuenta', async () => {
    const id = await budget();
    await seedCategory(id, { name: 'Comida', monthlyLimit: '200.00' });
    const antigua = await seedCategory(id, {
      name: 'Antigua',
      monthlyLimit: '50.00',
      isActive: false,
    });
    await seedTransaction(id, antigua, { amount: '20.00', date: '2026-10-10' });

    const response = await summary(ANA, id, 'month=2026-10');

    expect(response.json()).toMatchObject({
      allocated: '200.00',
      spent: '20.00',
      remaining: '180.00',
    });
  });

  it('el restante es negativo si se gasta más de lo asignado', async () => {
    const id = await budget();
    const ocio = await seedCategory(id, { name: 'Ocio', monthlyLimit: '100.00' });
    await seedTransaction(id, ocio, { amount: '120.00', date: '2026-10-05' });

    const response = await summary(ANA, id, 'month=2026-10');

    expect(response.json()).toMatchObject({
      allocated: '100.00',
      spent: '120.00',
      remaining: '-20.00',
      percentUsed: 120,
    });
  });

  it('un presupuesto vacío devuelve ceros y percentUsed null', async () => {
    const id = await budget();

    const response = await summary(ANA, id, 'month=2026-10');

    expect(response.json()).toEqual({
      month: '2026-10',
      currency: 'EUR',
      allocated: '0.00',
      spent: '0.00',
      remaining: '0.00',
      percentUsed: null,
    });
  });

  it('los importes son exactos en decimal', async () => {
    const id = await budget();
    const comida = await seedCategory(id, { name: 'Comida', monthlyLimit: '0.30' });
    await seedTransaction(id, comida, { amount: '0.10', date: '2026-10-01' });
    await seedTransaction(id, comida, { amount: '0.20', date: '2026-10-02' });

    const response = await summary(ANA, id, 'month=2026-10');

    expect(response.json()).toMatchObject({ spent: '0.30', remaining: '0.00', percentUsed: 100 });
  });

  it('usa la divisa del presupuesto', async () => {
    const id = await budget();
    await testPrisma.budget.update({ where: { id }, data: { currency: 'JPY' } });

    const response = await summary(ANA, id, 'month=2026-10');

    expect(response.json()).toMatchObject({ currency: 'JPY' });
  });

  it('sin month usa el mes actual (UTC)', async () => {
    const id = await budget();
    const comida = await seedCategory(id, { name: 'Comida', monthlyLimit: '50.00' });
    const today = new Date().toISOString().slice(0, 10);
    await seedTransaction(id, comida, { amount: '5.00', date: today });

    const response = await summary(ANA, id);

    expect(response.json()).toMatchObject({ month: today.slice(0, 7), spent: '5.00' });
  });

  it('no mezcla datos de otros presupuestos', async () => {
    const id = await budget();
    await seedCategory(id, { name: 'Comida', monthlyLimit: '10.00' });
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedCategory(other, { monthlyLimit: '999.00' });
    await seedTransaction(other, foreign, { amount: '50.00', date: '2026-10-05' });

    const response = await summary(ANA, id, 'month=2026-10');

    expect(response.json()).toMatchObject({ allocated: '10.00', spent: '0.00' });
  });

  it('un no miembro recibe 404', async () => {
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await summary(ANA, other, 'month=2026-10');

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Presupuesto no encontrado' } });
  });

  it.each([
    ['mes inválido', 'month=2026-13'],
    ['formato distinto', 'month=10-2026'],
    ['parámetro desconocido', 'year=2026'],
  ])('rechaza con 400: %s', async (_case, query) => {
    const id = await budget();

    const response = await summary(ANA, id, query);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});

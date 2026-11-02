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

/** ANA (OWNER), BEA (EDITOR), DANI (LIMITED_EDITOR) y CARLOS (VIEWER). */
async function familyBudget() {
  return seedBudget([
    { user: ANA, role: 'OWNER' },
    { user: BEA, role: 'EDITOR' },
    { user: DANI, role: 'LIMITED_EDITOR' },
    { user: CARLOS, role: 'VIEWER' },
  ]);
}

const MANAGERS = [
  ['OWNER', ANA],
  ['EDITOR', BEA],
] as const;

const NON_MANAGERS = [
  ['LIMITED_EDITOR', DANI],
  ['VIEWER', CARLOS],
] as const;

describe('POST /api/v1/budgets/:id/goals', () => {
  it.each(MANAGERS)('un %s crea una meta', async (_role, user) => {
    const id = await familyBudget();

    const response = await api(user, 'POST', `/budgets/${id}/goals`, {
      title: 'Vacaciones en Japón',
      targetAmount: '3000',
      deadline: '2027-07-01',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      title: 'Vacaciones en Japón',
      targetAmount: '3000.00',
      currentAmount: '0.00',
      deadline: '2027-07-01',
      status: 'IN_PROGRESS',
      createdAt: ISO_DATE,
      updatedAt: ISO_DATE,
    });
    await expect(storedGoal(response.json().id)).resolves.toMatchObject({ budgetId: id });
  });

  it('la fecha límite es opcional', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'POST', `/budgets/${id}/goals`, {
      title: 'Colchón',
      targetAmount: '500.50',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ targetAmount: '500.50', deadline: null });
  });

  it.each(NON_MANAGERS)('un %s recibe 403', async (_role, user) => {
    const id = await familyBudget();

    const response = await api(user, 'POST', `/budgets/${id}/goals`, {
      title: 'Coche',
      targetAmount: '100',
    });

    expect(response.statusCode).toBe(403);
    await expect(testPrisma.goal.count()).resolves.toBe(0);
  });

  it('un no miembro recibe 404', async () => {
    const id = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await api(ANA, 'POST', `/budgets/${id}/goals`, {
      title: 'Coche',
      targetAmount: '100',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Presupuesto no encontrado' } });
  });

  it.each([
    ['objetivo cero', { targetAmount: '0' }],
    ['objetivo negativo', { targetAmount: '-10' }],
    ['objetivo como número JSON', { targetAmount: 100 }],
    ['objetivo con 3 decimales', { targetAmount: '1.005' }],
    ['título vacío', { title: '' }],
    ['título solo con espacios', { title: '   ' }],
    ['título de más de 60 caracteres', { title: 'a'.repeat(61) }],
    ['fecha límite inválida', { deadline: '2027-02-30' }],
    ['fecha límite con hora', { deadline: '2027-07-01T00:00:00.000Z' }],
    ['currentAmount no se puede fijar', { currentAmount: '50' }],
    ['status no se puede fijar', { status: 'REACHED' }],
  ])('rechaza con 400: %s', async (_case, override) => {
    const id = await familyBudget();

    const response = await api(ANA, 'POST', `/budgets/${id}/goals`, {
      title: 'Coche',
      targetAmount: '100',
      ...override,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await expect(testPrisma.goal.count()).resolves.toBe(0);
  });
});

describe('GET /api/v1/budgets/:id/goals', () => {
  it('cualquier miembro lista las metas por orden de creación, incluidas las archivadas', async () => {
    const id = await familyBudget();
    const second = await seedGoal(id, {
      title: 'Coche',
      status: 'ARCHIVED',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const first = await seedGoal(id, {
      title: 'Vacaciones',
      currentAmount: '250.00',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    await seedGoal(other, { title: 'Ajena' });

    const response = await api(CARLOS, 'GET', `/budgets/${id}/goals`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({ id: first, title: 'Vacaciones', currentAmount: '250.00' }),
      expect.objectContaining({ id: second, status: 'ARCHIVED' }),
    ]);
  });

  it('filtra por estado', async () => {
    const id = await familyBudget();
    await seedGoal(id, { title: 'En curso' });
    await seedGoal(id, { title: 'Lograda', status: 'REACHED' });
    await seedGoal(id, { title: 'Archivada', status: 'ARCHIVED' });

    const response = await api(ANA, 'GET', `/budgets/${id}/goals?status=REACHED`);

    expect(response.json()).toEqual([expect.objectContaining({ title: 'Lograda' })]);
  });

  it('rechaza con 400 un estado desconocido', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'GET', `/budgets/${id}/goals?status=DONE`);

    expect(response.statusCode).toBe(400);
  });

  it('GET de una meta: cualquier miembro la ve; la de otro presupuesto, 404', async () => {
    const id = await familyBudget();
    const goal = await seedGoal(id, { title: 'Vacaciones' });
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedGoal(other);

    const own = await api(CARLOS, 'GET', `/budgets/${id}/goals/${goal}`);
    const ajena = await api(ANA, 'GET', `/budgets/${id}/goals/${foreign}`);

    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ id: goal, title: 'Vacaciones' });
    expect(ajena.statusCode).toBe(404);
    expect(ajena.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Meta no encontrada' } });
  });
});

describe('PATCH /api/v1/budgets/:id/goals/:goalId', () => {
  function edit(user: TestUser, budgetId: string, goalId: string, payload: object) {
    return api(user, 'PATCH', `/budgets/${budgetId}/goals/${goalId}`, payload);
  }

  it.each(MANAGERS)('un %s edita título, objetivo y fecha límite', async (_role, user) => {
    const id = await familyBudget();
    const goal = await seedGoal(id, { title: 'Viaje', targetAmount: '1000.00' });

    const response = await edit(user, id, goal, {
      title: 'Viaje a Roma',
      targetAmount: '1200.5',
      deadline: '2027-03-01',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      title: 'Viaje a Roma',
      targetAmount: '1200.50',
      deadline: '2027-03-01',
    });
  });

  it('deadline: null quita la fecha límite', async () => {
    const id = await familyBudget();
    const goal = await seedGoal(id);
    await testPrisma.goal.update({
      where: { id: goal },
      data: { deadline: new Date('2027-01-01') },
    });

    const response = await edit(ANA, id, goal, { deadline: null });

    expect(response.json()).toMatchObject({ deadline: null });
  });

  it('bajar el objetivo por debajo de lo ahorrado marca la meta como REACHED', async () => {
    const id = await familyBudget();
    const goal = await seedGoal(id, { targetAmount: '1000.00', currentAmount: '600.00' });

    const response = await edit(ANA, id, goal, { targetAmount: '600.00' });

    expect(response.json()).toMatchObject({ status: 'REACHED' });
  });

  it('subir el objetivo de una meta lograda la devuelve a IN_PROGRESS', async () => {
    const id = await familyBudget();
    const goal = await seedGoal(id, {
      targetAmount: '500.00',
      currentAmount: '500.00',
      status: 'REACHED',
    });

    const response = await edit(ANA, id, goal, { targetAmount: '800.00' });

    expect(response.json()).toMatchObject({ status: 'IN_PROGRESS' });
  });

  it('archived: true archiva la meta', async () => {
    const id = await familyBudget();
    const goal = await seedGoal(id);

    const response = await edit(BEA, id, goal, { archived: true });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ARCHIVED' });
  });

  it.each([
    ['sin alcanzar el objetivo vuelve a IN_PROGRESS', '100.00', 'IN_PROGRESS'],
    ['con el objetivo alcanzado vuelve a REACHED', '1000.00', 'REACHED'],
  ])('archived: false la desarchiva: %s', async (_case, currentAmount, status) => {
    const id = await familyBudget();
    const goal = await seedGoal(id, {
      targetAmount: '1000.00',
      currentAmount,
      status: 'ARCHIVED',
    });

    const response = await edit(ANA, id, goal, { archived: false });

    expect(response.json()).toMatchObject({ status });
  });

  it('cambiar el objetivo de una meta archivada la mantiene archivada', async () => {
    const id = await familyBudget();
    const goal = await seedGoal(id, { targetAmount: '1000.00', status: 'ARCHIVED' });

    const response = await edit(ANA, id, goal, { targetAmount: '10.00' });

    expect(response.json()).toMatchObject({ status: 'ARCHIVED', targetAmount: '10.00' });
  });

  it.each(NON_MANAGERS)('un %s recibe 403', async (_role, user) => {
    const id = await familyBudget();
    const goal = await seedGoal(id, { title: 'Viaje' });

    const response = await edit(user, id, goal, { title: 'Hackeada' });

    expect(response.statusCode).toBe(403);
    await expect(storedGoal(goal)).resolves.toMatchObject({ title: 'Viaje' });
  });

  it('una meta de otro presupuesto devuelve 404 y no se toca', async () => {
    const id = await familyBudget();
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedGoal(other, { title: 'Ajena' });

    const response = await edit(ANA, id, foreign, { title: 'Robada' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Meta no encontrada' } });
    await expect(storedGoal(foreign)).resolves.toMatchObject({ title: 'Ajena' });
  });

  it.each([
    ['cuerpo vacío', {}],
    ['objetivo cero', { targetAmount: '0.00' }],
    ['currentAmount no se puede editar', { currentAmount: '999' }],
    ['status no se puede fijar directamente', { status: 'REACHED' }],
    ['archived no booleano', { archived: 'yes' }],
  ])('rechaza con 400: %s', async (_case, payload) => {
    const id = await familyBudget();
    const goal = await seedGoal(id);

    const response = await edit(ANA, id, goal, payload);

    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /api/v1/budgets/:id/goals/:goalId', () => {
  it.each(MANAGERS)('un %s borra la meta y sus contribuciones', async (_role, user) => {
    const id = await familyBudget();
    const goal = await seedGoal(id, { currentAmount: '20.00' });
    await testPrisma.goalContribution.create({
      data: { goalId: goal, userId: DANI.sub, amount: '20.00' },
    });

    const response = await api(user, 'DELETE', `/budgets/${id}/goals/${goal}`);

    expect(response.statusCode).toBe(204);
    await expect(storedGoal(goal)).resolves.toBeNull();
    await expect(testPrisma.goalContribution.count({ where: { goalId: goal } })).resolves.toBe(0);
  });

  it.each(NON_MANAGERS)('un %s recibe 403', async (_role, user) => {
    const id = await familyBudget();
    const goal = await seedGoal(id);

    const response = await api(user, 'DELETE', `/budgets/${id}/goals/${goal}`);

    expect(response.statusCode).toBe(403);
    await expect(storedGoal(goal)).resolves.not.toBeNull();
  });

  it('una meta de otro presupuesto o inexistente devuelve 404', async () => {
    const id = await familyBudget();
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedGoal(other);

    const ajena = await api(ANA, 'DELETE', `/budgets/${id}/goals/${foreign}`);
    const missing = await api(ANA, 'DELETE', `/budgets/${id}/goals/${MISSING_ID}`);

    expect(ajena.statusCode).toBe(404);
    expect(ajena.json()).toMatchObject({ error: { message: 'Meta no encontrada' } });
    expect(missing.statusCode).toBe(404);
    await expect(storedGoal(foreign)).resolves.not.toBeNull();
  });
});

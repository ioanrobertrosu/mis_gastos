import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { seedCategory, seedTransaction, storedTransaction } from '../helpers/budget-data.js';
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

/** ANA (OWNER), BEA (EDITOR), DANI (LIMITED_EDITOR) y CARLOS (VIEWER), con una categoría. */
async function familyBudget() {
  const budgetId = await seedBudget([
    { user: ANA, role: 'OWNER' },
    { user: BEA, role: 'EDITOR' },
    { user: DANI, role: 'LIMITED_EDITOR' },
    { user: CARLOS, role: 'VIEWER' },
  ]);
  const categoryId = await seedCategory(budgetId);
  return { budgetId, categoryId };
}

function create(user: TestUser, budgetId: string, payload: object) {
  return api(user, 'POST', `/budgets/${budgetId}/transactions`, payload);
}

describe('POST /api/v1/budgets/:id/transactions', () => {
  it.each([
    ['OWNER', ANA],
    ['EDITOR', BEA],
    ['LIMITED_EDITOR', DANI],
  ] as const)('un %s registra un gasto y queda como autor', async (_role, user) => {
    const { budgetId, categoryId } = await familyBudget();

    const response = await create(user, budgetId, {
      categoryId,
      amount: '12.5',
      description: 'Mercadona',
      date: '2026-10-15',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      categoryId,
      amount: '12.50',
      description: 'Mercadona',
      date: '2026-10-15',
      isRecurring: false,
      createdById: user.sub,
      createdAt: ISO_DATE,
      updatedAt: ISO_DATE,
    });
    await expect(storedTransaction(response.json().id)).resolves.toMatchObject({
      budgetId,
      amount: '12.50',
      date: '2026-10-15',
    });
  });

  it('la descripción es opcional', async () => {
    const { budgetId, categoryId } = await familyBudget();

    const response = await create(ANA, budgetId, { categoryId, amount: '3', date: '2026-10-01' });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ amount: '3.00', description: null });
  });

  it('un VIEWER recibe 403', async () => {
    const { budgetId, categoryId } = await familyBudget();

    const response = await create(CARLOS, budgetId, {
      categoryId,
      amount: '10',
      date: '2026-10-15',
    });

    expect(response.statusCode).toBe(403);
    await expect(testPrisma.transaction.count()).resolves.toBe(0);
  });

  it('un no miembro recibe 404', async () => {
    const budgetId = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const categoryId = await seedCategory(budgetId);

    const response = await create(ANA, budgetId, { categoryId, amount: '10', date: '2026-10-15' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Presupuesto no encontrado' } });
  });

  it('no se puede registrar en una categoría inactiva (409)', async () => {
    const { budgetId } = await familyBudget();
    const inactive = await seedCategory(budgetId, { name: 'Antigua', isActive: false });

    const response = await create(ANA, budgetId, {
      categoryId: inactive,
      amount: '10',
      date: '2026-10-15',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    await expect(testPrisma.transaction.count()).resolves.toBe(0);
  });

  it.each([
    ['de otro presupuesto', 'foreign'],
    ['inexistente', 'missing'],
  ])('una categoría %s devuelve 404 "Categoría no encontrada"', async (_case, kind) => {
    const { budgetId } = await familyBudget();
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const categoryId = kind === 'foreign' ? await seedCategory(other) : MISSING_ID;

    const response = await create(ANA, budgetId, { categoryId, amount: '10', date: '2026-10-15' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Categoría no encontrada' },
    });
    await expect(testPrisma.transaction.count()).resolves.toBe(0);
  });

  it.each([
    ['7', '7.00'],
    ['7.5', '7.50'],
    ['0.01', '0.01'],
    ['9999999999.99', '9999999999.99'],
  ])('acepta el importe %s y lo devuelve como %s', async (amount, expected) => {
    const { budgetId, categoryId } = await familyBudget();

    const response = await create(ANA, budgetId, { categoryId, amount, date: '2026-10-15' });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ amount: expected });
  });

  it('los importes se suman en decimal exacto (0.10 + 0.20 = 0.30)', async () => {
    const { budgetId, categoryId } = await familyBudget();
    await create(ANA, budgetId, { categoryId, amount: '0.10', date: '2026-10-15' });
    await create(ANA, budgetId, { categoryId, amount: '0.20', date: '2026-10-15' });

    const { _sum } = await testPrisma.transaction.aggregate({
      where: { budgetId },
      _sum: { amount: true },
    });

    expect(_sum.amount?.toFixed(2)).toBe('0.30');
    expect(_sum.amount?.toString()).toBe('0.3');
  });

  it.each([
    ['importe como número JSON (float)', { amount: 12.5 }],
    ['importe con 3 decimales', { amount: '12.345' }],
    ['importe negativo', { amount: '-3' }],
    ['importe cero', { amount: '0' }],
    ['importe 0.00', { amount: '0.00' }],
    ['importe que no es un número', { amount: 'doce' }],
    ['importe vacío', { amount: '' }],
    ['importe con más de 10 cifras enteras', { amount: '12345678901' }],
    ['fecha en otro formato', { date: '15/10/2026' }],
    ['fecha imposible', { date: '2026-02-30' }],
    ['fecha con hora', { date: '2026-10-15T10:00:00.000Z' }],
    ['descripción vacía', { description: '' }],
    ['descripción solo con espacios', { description: '   ' }],
    ['descripción de más de 200 caracteres', { description: 'a'.repeat(201) }],
    ['categoryId que no es UUID', { categoryId: 'comida' }],
    ['campo no permitido', { createdById: BEA.sub }],
  ])('rechaza con 400: %s', async (_case, override) => {
    const { budgetId, categoryId } = await familyBudget();

    const response = await create(ANA, budgetId, {
      categoryId,
      amount: '10',
      date: '2026-10-15',
      ...override,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await expect(testPrisma.transaction.count()).resolves.toBe(0);
  });

  it.each([['categoryId'], ['amount'], ['date']])('rechaza con 400 si falta %s', async (field) => {
    const { budgetId, categoryId } = await familyBudget();
    const payload: Record<string, string> = { categoryId, amount: '10', date: '2026-10-15' };
    delete payload[field];

    const response = await create(ANA, budgetId, payload);

    expect(response.statusCode).toBe(400);
  });
});

describe('isRecurring (marca informativa)', () => {
  it('se acepta al crear y por defecto es false', async () => {
    const { budgetId, categoryId } = await familyBudget();

    const recurring = await create(ANA, budgetId, {
      categoryId,
      amount: '400',
      date: '2026-10-01',
      description: 'Alquiler',
      isRecurring: true,
    });
    const once = await create(ANA, budgetId, { categoryId, amount: '5', date: '2026-10-02' });

    expect(recurring.statusCode).toBe(201);
    expect(recurring.json()).toMatchObject({ isRecurring: true });
    expect(once.json()).toMatchObject({ isRecurring: false });
    await expect(storedTransaction(recurring.json().id)).resolves.toMatchObject({
      isRecurring: true,
    });
  });

  it('se puede cambiar al editar', async () => {
    const { budgetId, categoryId } = await familyBudget();
    const id = await seedTransaction(budgetId, categoryId, { createdBy: DANI });

    const response = await api(DANI, 'PATCH', `/budgets/${budgetId}/transactions/${id}`, {
      isRecurring: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ isRecurring: true });
    await expect(storedTransaction(id)).resolves.toMatchObject({ isRecurring: true });
  });

  it('no genera transacciones automáticamente: solo se guarda la marca', async () => {
    const { budgetId, categoryId } = await familyBudget();

    await create(ANA, budgetId, {
      categoryId,
      amount: '400',
      date: '2026-10-01',
      isRecurring: true,
    });

    await expect(testPrisma.transaction.count({ where: { budgetId } })).resolves.toBe(1);
  });

  it.each([
    ['texto en vez de booleano', { isRecurring: 'true' }],
    ['número en vez de booleano', { isRecurring: 1 }],
    ['null', { isRecurring: null }],
  ])('rechaza con 400: %s', async (_case, override) => {
    const { budgetId, categoryId } = await familyBudget();

    const response = await create(ANA, budgetId, {
      categoryId,
      amount: '10',
      date: '2026-10-15',
      ...override,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});

describe('GET /api/v1/budgets/:id/transactions/:transactionId', () => {
  it('cualquier miembro ve una transacción', async () => {
    const { budgetId, categoryId } = await familyBudget();
    const id = await seedTransaction(budgetId, categoryId, { createdBy: DANI, amount: '4.20' });

    const response = await api(CARLOS, 'GET', `/budgets/${budgetId}/transactions/${id}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id, amount: '4.20', createdById: DANI.sub });
  });

  it('una transacción de otro presupuesto devuelve 404 "Transacción no encontrada"', async () => {
    const { budgetId } = await familyBudget();
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedTransaction(other, await seedCategory(other), { createdBy: BEA });

    const response = await api(ANA, 'GET', `/budgets/${budgetId}/transactions/${foreign}`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Transacción no encontrada' },
    });
  });
});

describe('PATCH /api/v1/budgets/:id/transactions/:transactionId', () => {
  function edit(user: TestUser, budgetId: string, id: string, payload: object) {
    return api(user, 'PATCH', `/budgets/${budgetId}/transactions/${id}`, payload);
  }

  it.each([
    ['OWNER edita la de un LIMITED_EDITOR', ANA, DANI],
    ['EDITOR edita la del OWNER', BEA, ANA],
    ['LIMITED_EDITOR edita la suya', DANI, DANI],
  ] as const)('%s', async (_case, editor, author) => {
    const { budgetId, categoryId } = await familyBudget();
    const id = await seedTransaction(budgetId, categoryId, { createdBy: author, amount: '10.00' });

    const response = await edit(editor, budgetId, id, { amount: '11.99' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id, amount: '11.99', createdById: author.sub });
    await expect(storedTransaction(id)).resolves.toMatchObject({ amount: '11.99' });
  });

  it('un LIMITED_EDITOR no puede editar la transacción de otro (403)', async () => {
    const { budgetId, categoryId } = await familyBudget();
    const id = await seedTransaction(budgetId, categoryId, { createdBy: BEA, amount: '10.00' });

    const response = await edit(DANI, budgetId, id, { amount: '1.00' });

    expect(response.statusCode).toBe(403);
    await expect(storedTransaction(id)).resolves.toMatchObject({ amount: '10.00' });
  });

  it('un LIMITED_EDITOR no puede editar la de un usuario borrado (sin autor)', async () => {
    const { budgetId, categoryId } = await familyBudget();
    const id = await seedTransaction(budgetId, categoryId, { amount: '10.00' });

    const response = await edit(DANI, budgetId, id, { amount: '1.00' });

    expect(response.statusCode).toBe(403);
  });

  it('un VIEWER recibe 403', async () => {
    const { budgetId, categoryId } = await familyBudget();
    const id = await seedTransaction(budgetId, categoryId, { createdBy: ANA });

    const response = await edit(CARLOS, budgetId, id, { amount: '1.00' });

    expect(response.statusCode).toBe(403);
  });

  it('cambia la categoría, la fecha y borra la descripción con null', async () => {
    const { budgetId, categoryId } = await familyBudget();
    const ocio = await seedCategory(budgetId, { name: 'Ocio' });
    const id = await seedTransaction(budgetId, categoryId, {
      createdBy: ANA,
      description: 'Cine',
    });

    const response = await edit(ANA, budgetId, id, {
      categoryId: ocio,
      date: '2026-09-30',
      description: null,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      categoryId: ocio,
      date: '2026-09-30',
      description: null,
    });
  });

  it('no se puede mover a una categoría inactiva (409)', async () => {
    const { budgetId, categoryId } = await familyBudget();
    const inactive = await seedCategory(budgetId, { isActive: false });
    const id = await seedTransaction(budgetId, categoryId, { createdBy: ANA });

    const response = await edit(ANA, budgetId, id, { categoryId: inactive });

    expect(response.statusCode).toBe(409);
    await expect(storedTransaction(id)).resolves.toMatchObject({ categoryId });
  });

  it('no se puede mover a una categoría de otro presupuesto (404)', async () => {
    const { budgetId, categoryId } = await familyBudget();
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedCategory(other);
    const id = await seedTransaction(budgetId, categoryId, { createdBy: ANA });

    const response = await edit(ANA, budgetId, id, { categoryId: foreign });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Categoría no encontrada' } });
    await expect(storedTransaction(id)).resolves.toMatchObject({ categoryId, budgetId });
  });

  it('sigue pudiendo editarse una transacción cuya categoría se desactivó', async () => {
    const { budgetId, categoryId } = await familyBudget();
    const id = await seedTransaction(budgetId, categoryId, { createdBy: ANA });
    await testPrisma.category.update({ where: { id: categoryId }, data: { isActive: false } });

    const response = await edit(ANA, budgetId, id, { amount: '20.00' });

    expect(response.statusCode).toBe(200);
  });

  it('una transacción de otro presupuesto devuelve 404 y no se toca', async () => {
    const { budgetId } = await familyBudget();
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedTransaction(other, await seedCategory(other), {
      createdBy: BEA,
      amount: '10.00',
    });

    const response = await edit(ANA, budgetId, foreign, { amount: '1.00' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Transacción no encontrada' } });
    await expect(storedTransaction(foreign)).resolves.toMatchObject({ amount: '10.00' });
  });

  it.each([
    ['cuerpo vacío', {}],
    ['importe float', { amount: 1.5 }],
    ['fecha inválida', { date: '2026-13-01' }],
    ['campo no permitido', { createdById: ANA.sub }],
  ])('rechaza con 400: %s', async (_case, payload) => {
    const { budgetId, categoryId } = await familyBudget();
    const id = await seedTransaction(budgetId, categoryId, { createdBy: ANA });

    const response = await edit(ANA, budgetId, id, payload);

    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /api/v1/budgets/:id/transactions/:transactionId', () => {
  function remove(user: TestUser, budgetId: string, id: string) {
    return api(user, 'DELETE', `/budgets/${budgetId}/transactions/${id}`);
  }

  it.each([
    ['LIMITED_EDITOR borra la suya', DANI, DANI],
    ['EDITOR borra la de otro', BEA, DANI],
    ['OWNER borra la de otro', ANA, BEA],
  ] as const)('%s', async (_case, user, author) => {
    const { budgetId, categoryId } = await familyBudget();
    const id = await seedTransaction(budgetId, categoryId, { createdBy: author });

    const response = await remove(user, budgetId, id);

    expect(response.statusCode).toBe(204);
    await expect(storedTransaction(id)).resolves.toBeNull();
  });

  it.each([
    ['LIMITED_EDITOR, la de otro', DANI],
    ['VIEWER', CARLOS],
  ] as const)('un %s recibe 403 y la transacción se conserva', async (_case, user) => {
    const { budgetId, categoryId } = await familyBudget();
    const id = await seedTransaction(budgetId, categoryId, { createdBy: BEA });

    const response = await remove(user, budgetId, id);

    expect(response.statusCode).toBe(403);
    await expect(storedTransaction(id)).resolves.not.toBeNull();
  });

  it('una transacción de otro presupuesto devuelve 404 y no se borra', async () => {
    const { budgetId } = await familyBudget();
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedTransaction(other, await seedCategory(other), { createdBy: BEA });

    const response = await remove(ANA, budgetId, foreign);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Transacción no encontrada' } });
    await expect(storedTransaction(foreign)).resolves.not.toBeNull();
  });

  it('una transacción inexistente devuelve 404', async () => {
    const { budgetId } = await familyBudget();

    const response = await remove(ANA, budgetId, MISSING_ID);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Transacción no encontrada' } });
  });
});

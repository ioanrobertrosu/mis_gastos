import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
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

async function seedCategory(
  budgetId: string,
  data: { name?: string; monthlyLimit?: string; isActive?: boolean; createdAt?: Date } = {},
) {
  const category = await testPrisma.category.create({
    data: { budgetId, name: 'Comida', monthlyLimit: '300.00', ...data },
  });
  return category.id;
}

async function stored(categoryId: string) {
  const category = await testPrisma.category.findUnique({ where: { id: categoryId } });
  return category && { ...category, monthlyLimit: category.monthlyLimit.toFixed(2) };
}

const NON_OWNERS: [string, TestUser][] = [
  ['EDITOR', BEA],
  ['LIMITED_EDITOR', DANI],
  ['VIEWER', CARLOS],
];

describe('POST /api/v1/budgets/:id/categories', () => {
  it('el OWNER crea una categoría y los importes se devuelven con 2 decimales', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'POST', `/budgets/${id}/categories`, {
      name: 'Supermercado',
      monthlyLimit: '250',
      icon: 'shopping-cart',
      colorHex: '#22C55E',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      name: 'Supermercado',
      monthlyLimit: '250.00',
      icon: 'shopping-cart',
      colorHex: '#22C55E',
      isActive: true,
      createdAt: ISO_DATE,
      updatedAt: ISO_DATE,
    });
    await expect(stored(response.json().id)).resolves.toMatchObject({
      budgetId: id,
      monthlyLimit: '250.00',
    });
  });

  it('aplica el icono y el color por defecto, y acepta un límite de 0', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'POST', `/budgets/${id}/categories`, {
      name: 'Varios',
      monthlyLimit: '0',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      monthlyLimit: '0.00',
      icon: 'folder',
      colorHex: '#64748B',
    });
  });

  it('conserva los céntimos exactos (sin errores de coma flotante)', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'POST', `/budgets/${id}/categories`, {
      name: 'Exacto',
      monthlyLimit: '9999999999.99',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ monthlyLimit: '9999999999.99' });
  });

  it.each([
    ['límite negativo', { monthlyLimit: '-5' }],
    ['límite con 3 decimales', { monthlyLimit: '12.345' }],
    ['límite como número JSON (float)', { monthlyLimit: 250 }],
    ['límite que no es un importe', { monthlyLimit: 'abc' }],
    ['límite con más de 10 cifras enteras', { monthlyLimit: '12345678901' }],
    ['límite vacío', { monthlyLimit: '' }],
    ['color con nombre', { colorHex: 'red' }],
    ['color hex corto', { colorHex: '#FFF' }],
    ['color hex inválido', { colorHex: '#GGGGGG' }],
    ['nombre vacío', { name: '' }],
    ['nombre solo con espacios', { name: '   ' }],
    ['nombre de más de 40 caracteres', { name: 'a'.repeat(41) }],
    ['icono vacío', { icon: '' }],
    ['icono con espacios o mayúsculas', { icon: 'Shopping Cart' }],
    ['campo no permitido', { isActive: false }],
  ])('rechaza con 400: %s', async (_case, override) => {
    const id = await familyBudget();

    const response = await api(ANA, 'POST', `/budgets/${id}/categories`, {
      name: 'Supermercado',
      monthlyLimit: '250.00',
      ...override,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await expect(testPrisma.category.count()).resolves.toBe(0);
  });

  it.each([
    ['sin nombre', { monthlyLimit: '250.00' }],
    ['sin límite', { name: 'Supermercado' }],
  ])('rechaza con 400: %s', async (_case, payload) => {
    const id = await familyBudget();

    const response = await api(ANA, 'POST', `/budgets/${id}/categories`, payload);

    expect(response.statusCode).toBe(400);
  });

  it.each(NON_OWNERS)('un %s recibe 403', async (_role, user) => {
    const id = await familyBudget();

    const response = await api(user, 'POST', `/budgets/${id}/categories`, {
      name: 'Supermercado',
      monthlyLimit: '250.00',
    });

    expect(response.statusCode).toBe(403);
    await expect(testPrisma.category.count()).resolves.toBe(0);
  });

  it('un no miembro recibe 404', async () => {
    const id = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await api(ANA, 'POST', `/budgets/${id}/categories`, {
      name: 'Supermercado',
      monthlyLimit: '250.00',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Presupuesto no encontrado' } });
  });
});

describe('GET /api/v1/budgets/:id/categories', () => {
  it('cualquier miembro lista las categorías activas por orden de creación', async () => {
    const id = await familyBudget();
    const second = await seedCategory(id, {
      name: 'Ocio',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const first = await seedCategory(id, {
      name: 'Comida',
      monthlyLimit: '400.5',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await seedCategory(id, { name: 'Antigua', isActive: false });
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    await seedCategory(other, { name: 'De otro presupuesto' });

    const response = await api(CARLOS, 'GET', `/budgets/${id}/categories`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({ id: first, name: 'Comida', monthlyLimit: '400.50' }),
      expect.objectContaining({ id: second, name: 'Ocio', isActive: true }),
    ]);
  });

  it('con includeInactive=true incluye también las desactivadas', async () => {
    const id = await familyBudget();
    await seedCategory(id, { name: 'Activa' });
    await seedCategory(id, { name: 'Antigua', isActive: false });

    const response = await api(ANA, 'GET', `/budgets/${id}/categories?includeInactive=true`);

    expect(response.statusCode).toBe(200);
    expect(
      response
        .json()
        .map((category: { name: string }) => category.name)
        .sort(),
    ).toEqual(['Activa', 'Antigua']);
  });

  it('rechaza con 400 un includeInactive que no es booleano', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'GET', `/budgets/${id}/categories?includeInactive=quizas`);

    expect(response.statusCode).toBe(400);
  });

  it('un no miembro recibe 404', async () => {
    const id = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await api(ANA, 'GET', `/budgets/${id}/categories`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Presupuesto no encontrado' } });
  });
});

describe('PATCH /api/v1/budgets/:id/categories/:categoryId', () => {
  it('el OWNER actualiza parcialmente una categoría', async () => {
    const id = await familyBudget();
    const categoryId = await seedCategory(id, { name: 'Comida', monthlyLimit: '300.00' });

    const response = await api(ANA, 'PATCH', `/budgets/${id}/categories/${categoryId}`, {
      monthlyLimit: '350.5',
      colorHex: '#EF4444',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: categoryId,
      name: 'Comida',
      monthlyLimit: '350.50',
      colorHex: '#EF4444',
      icon: 'folder',
    });
    await expect(stored(categoryId)).resolves.toMatchObject({ monthlyLimit: '350.50' });
  });

  it('isActive: true reactiva una categoría desactivada', async () => {
    const id = await familyBudget();
    const categoryId = await seedCategory(id, { isActive: false });

    const response = await api(ANA, 'PATCH', `/budgets/${id}/categories/${categoryId}`, {
      isActive: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ isActive: true });
  });

  it.each(NON_OWNERS)('un %s recibe 403', async (_role, user) => {
    const id = await familyBudget();
    const categoryId = await seedCategory(id, { name: 'Comida' });

    const response = await api(user, 'PATCH', `/budgets/${id}/categories/${categoryId}`, {
      name: 'Hackeada',
    });

    expect(response.statusCode).toBe(403);
    await expect(stored(categoryId)).resolves.toMatchObject({ name: 'Comida' });
  });

  it('una categoría de otro presupuesto devuelve 404 "Categoría no encontrada"', async () => {
    const id = await familyBudget();
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedCategory(other, { name: 'Ajena' });

    const response = await api(ANA, 'PATCH', `/budgets/${id}/categories/${foreign}`, {
      name: 'Robada',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Categoría no encontrada' },
    });
    await expect(stored(foreign)).resolves.toMatchObject({ name: 'Ajena' });
  });

  it('una categoría inexistente devuelve 404', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'PATCH', `/budgets/${id}/categories/${MISSING_ID}`, {
      name: 'Nada',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Categoría no encontrada' } });
  });

  it.each([
    ['cuerpo vacío', {}],
    ['límite negativo', { monthlyLimit: '-1' }],
    ['color inválido', { colorHex: 'azul' }],
    ['campo no permitido', { budgetId: MISSING_ID }],
  ])('rechaza con 400: %s', async (_case, payload) => {
    const id = await familyBudget();
    const categoryId = await seedCategory(id);

    const response = await api(ANA, 'PATCH', `/budgets/${id}/categories/${categoryId}`, payload);

    expect(response.statusCode).toBe(400);
  });

  it('rechaza con 400 un categoryId que no es UUID', async () => {
    const id = await familyBudget();

    const response = await api(ANA, 'PATCH', `/budgets/${id}/categories/no-es-un-uuid`, {
      name: 'X',
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /api/v1/budgets/:id/categories/:categoryId', () => {
  it('el OWNER la desactiva (soft delete): la fila se conserva y deja de listarse', async () => {
    const id = await familyBudget();
    const categoryId = await seedCategory(id);

    const response = await api(ANA, 'DELETE', `/budgets/${id}/categories/${categoryId}`);

    expect(response.statusCode).toBe(204);
    await expect(stored(categoryId)).resolves.toMatchObject({ isActive: false });
    expect((await api(ANA, 'GET', `/budgets/${id}/categories`)).json()).toEqual([]);
  });

  it('desactivar una categoría ya inactiva es idempotente (204)', async () => {
    const id = await familyBudget();
    const categoryId = await seedCategory(id, { isActive: false });

    const response = await api(ANA, 'DELETE', `/budgets/${id}/categories/${categoryId}`);

    expect(response.statusCode).toBe(204);
  });

  it.each(NON_OWNERS)('un %s recibe 403', async (_role, user) => {
    const id = await familyBudget();
    const categoryId = await seedCategory(id);

    const response = await api(user, 'DELETE', `/budgets/${id}/categories/${categoryId}`);

    expect(response.statusCode).toBe(403);
    await expect(stored(categoryId)).resolves.toMatchObject({ isActive: true });
  });

  it('una categoría de otro presupuesto devuelve 404 y no se toca', async () => {
    const id = await familyBudget();
    const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const foreign = await seedCategory(other);

    const response = await api(ANA, 'DELETE', `/budgets/${id}/categories/${foreign}`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { message: 'Categoría no encontrada' } });
    await expect(stored(foreign)).resolves.toMatchObject({ isActive: true });
  });
});

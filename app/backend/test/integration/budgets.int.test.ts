import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import { ANA, authHeader, BEA, seedBudget, type TestUser } from '../helpers/users.js';

const UUID = expect.stringMatching(/^[0-9a-f-]{36}$/);
const ISO_DATE = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
});

async function api(
  user: TestUser | null,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

describe('POST /api/v1/budgets', () => {
  it('crea el presupuesto y asigna al creador como OWNER', async () => {
    const response = await api(ANA, 'POST', '/budgets', { name: 'Casa' });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toEqual({
      id: UUID,
      name: 'Casa',
      currency: 'EUR',
      role: 'OWNER',
      memberCount: 1,
      createdAt: ISO_DATE,
      updatedAt: ISO_DATE,
    });
    await expect(
      testPrisma.budgetMember.findMany({
        where: { budgetId: body.id },
        select: { userId: true, role: true },
      }),
    ).resolves.toEqual([{ userId: ANA.sub, role: 'OWNER' }]);
  });

  it('respeta la divisa indicada', async () => {
    const response = await api(ANA, 'POST', '/budgets', { name: 'Viaje', currency: 'USD' });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ currency: 'USD' });
  });

  it.each([
    ['sin nombre', {}],
    ['nombre vacío', { name: '' }],
    ['nombre solo con espacios', { name: '   ' }],
    ['nombre de más de 60 caracteres', { name: 'a'.repeat(61) }],
    ['divisa no soportada', { name: 'Casa', currency: 'BTC' }],
    ['campo no permitido', { name: 'Casa', role: 'VIEWER' }],
  ])('rechaza con 400 un cuerpo inválido: %s', async (_case, payload) => {
    const response = await api(ANA, 'POST', '/budgets', payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await expect(testPrisma.budget.count()).resolves.toBe(0);
  });

  it('con 3 presupuestos (propios o compartidos) rechaza el 4.º con 422 LIMIT_EXCEEDED', async () => {
    await seedBudget([{ user: ANA, role: 'OWNER' }]);
    await seedBudget([{ user: ANA, role: 'OWNER' }]);
    await seedBudget([
      { user: BEA, role: 'OWNER' },
      { user: ANA, role: 'VIEWER' },
    ]);

    const response = await api(ANA, 'POST', '/budgets', { name: 'Cuarto' });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: { code: 'LIMIT_EXCEEDED', message: expect.any(String) },
    });
    await expect(testPrisma.budget.count()).resolves.toBe(3);
  });

  it('peticiones simultáneas no superan el límite de 3 presupuestos', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) => api(ANA, 'POST', '/budgets', { name: `P${i}` })),
    );

    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([201, 201, 201, 422, 422]);
    await expect(testPrisma.budgetMember.count({ where: { userId: ANA.sub } })).resolves.toBe(3);
    await expect(testPrisma.budget.count()).resolves.toBe(3);
  });

  it('sin token devuelve 401', async () => {
    const response = await api(null, 'POST', '/budgets', { name: 'Casa' });

    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/v1/budgets', () => {
  it('lista solo los presupuestos del usuario, con su rol, por orden de incorporación', async () => {
    const casa = await seedBudget([{ user: ANA, role: 'OWNER' }], { name: 'Casa' });
    await seedBudget([{ user: BEA, role: 'OWNER' }], { name: 'Ajeno' });
    const compartido = await seedBudget(
      [
        { user: BEA, role: 'OWNER' },
        { user: ANA, role: 'EDITOR' },
      ],
      { name: 'Compartido' },
    );

    const response = await api(ANA, 'GET', '/budgets');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({ id: casa, name: 'Casa', role: 'OWNER', memberCount: 1 }),
      expect.objectContaining({
        id: compartido,
        name: 'Compartido',
        role: 'EDITOR',
        memberCount: 2,
      }),
    ]);
  });

  it('devuelve una lista vacía si el usuario no tiene presupuestos', async () => {
    const response = await api(ANA, 'GET', '/budgets');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});

describe('GET /api/v1/budgets/:id', () => {
  it('devuelve el presupuesto con el rol del usuario', async () => {
    const id = await seedBudget(
      [
        { user: BEA, role: 'OWNER' },
        { user: ANA, role: 'VIEWER' },
      ],
      { name: 'Compartido' },
    );

    const response = await api(ANA, 'GET', `/budgets/${id}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id,
      name: 'Compartido',
      currency: 'EUR',
      role: 'VIEWER',
      memberCount: 2,
      createdAt: ISO_DATE,
      updatedAt: ISO_DATE,
    });
  });

  it('devuelve 404 si el usuario no es miembro, igual que si no existiera', async () => {
    const ajeno = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const notMember = await api(ANA, 'GET', `/budgets/${ajeno}`);
    const missing = await api(ANA, 'GET', `/budgets/${MISSING_ID}`);

    expect(notMember.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    // Mismo cuerpo en ambos casos: no se revela si el presupuesto existe.
    expect(notMember.json()).toEqual(missing.json());
    expect(notMember.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('devuelve 400 si el id no es un UUID', async () => {
    const response = await api(ANA, 'GET', '/budgets/no-es-un-uuid');

    expect(response.statusCode).toBe(400);
  });
});

const NON_OWNER_ROLES = ['EDITOR', 'LIMITED_EDITOR', 'VIEWER'] as const;

describe('PATCH /api/v1/budgets/:id', () => {
  it('el OWNER cambia el nombre y la divisa', async () => {
    const id = await seedBudget([{ user: ANA, role: 'OWNER' }], { name: 'Casa' });

    const response = await api(ANA, 'PATCH', `/budgets/${id}`, {
      name: 'Hogar',
      currency: 'GBP',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id, name: 'Hogar', currency: 'GBP', role: 'OWNER' });
    await expect(
      testPrisma.budget.findUnique({ where: { id }, select: { name: true, currency: true } }),
    ).resolves.toEqual({ name: 'Hogar', currency: 'GBP' });
  });

  it('una actualización parcial no toca los demás campos', async () => {
    const id = await seedBudget([{ user: ANA, role: 'OWNER' }], { name: 'Casa' });

    const response = await api(ANA, 'PATCH', `/budgets/${id}`, { currency: 'JPY' });

    expect(response.json()).toMatchObject({ name: 'Casa', currency: 'JPY' });
  });

  it.each(NON_OWNER_ROLES)('un %s recibe 403 y el presupuesto no cambia', async (role) => {
    const id = await seedBudget(
      [
        { user: BEA, role: 'OWNER' },
        { user: ANA, role },
      ],
      { name: 'Casa' },
    );

    const response = await api(ANA, 'PATCH', `/budgets/${id}`, { name: 'Hackeado' });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    await expect(
      testPrisma.budget.findUnique({ where: { id }, select: { name: true } }),
    ).resolves.toEqual({ name: 'Casa' });
  });

  it('un no miembro recibe 404', async () => {
    const id = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await api(ANA, 'PATCH', `/budgets/${id}`, { name: 'Hackeado' });

    expect(response.statusCode).toBe(404);
    // El mismo 404 que da el presupuesto, no el de "ruta inexistente".
    expect(response.json()).toEqual((await api(ANA, 'GET', `/budgets/${id}`)).json());
  });

  it.each([
    ['cuerpo vacío', {}],
    ['nombre vacío', { name: '' }],
    ['divisa no soportada', { currency: 'BTC' }],
    ['campo no permitido', { name: 'Casa', createdAt: '2020-01-01T00:00:00.000Z' }],
  ])('rechaza con 400 un cuerpo inválido: %s', async (_case, payload) => {
    const id = await seedBudget([{ user: ANA, role: 'OWNER' }]);

    const response = await api(ANA, 'PATCH', `/budgets/${id}`, payload);

    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /api/v1/budgets/:id', () => {
  it('el OWNER borra el presupuesto y sus membresías', async () => {
    const id = await seedBudget([
      { user: ANA, role: 'OWNER' },
      { user: BEA, role: 'EDITOR' },
    ]);

    const response = await api(ANA, 'DELETE', `/budgets/${id}`);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    await expect(testPrisma.budget.count()).resolves.toBe(0);
    await expect(testPrisma.budgetMember.count()).resolves.toBe(0);
  });

  it.each(NON_OWNER_ROLES)('un %s recibe 403 y el presupuesto se conserva', async (role) => {
    const id = await seedBudget([
      { user: BEA, role: 'OWNER' },
      { user: ANA, role },
    ]);

    const response = await api(ANA, 'DELETE', `/budgets/${id}`);

    expect(response.statusCode).toBe(403);
    await expect(testPrisma.budget.count({ where: { id } })).resolves.toBe(1);
  });

  it('un no miembro recibe 404', async () => {
    const id = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await api(ANA, 'DELETE', `/budgets/${id}`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual((await api(ANA, 'GET', `/budgets/${id}`)).json());
    await expect(testPrisma.budget.count({ where: { id } })).resolves.toBe(1);
  });

  it('devuelve 400 si el id no es un UUID', async () => {
    const response = await api(ANA, 'DELETE', '/budgets/no-es-un-uuid');

    expect(response.statusCode).toBe(400);
  });
});

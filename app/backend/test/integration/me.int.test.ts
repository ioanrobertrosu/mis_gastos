import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testPrisma } from '../helpers/db.js';
import { signTestToken, TEST_AUTH, TEST_USER } from '../helpers/jwt.js';

const ISO_DATE = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
});

async function request(method: 'GET' | 'PATCH', payload?: unknown, authenticated = true) {
  const headers: Record<string, string> = {};
  if (authenticated) headers.authorization = `Bearer ${await signTestToken()}`;
  return app.inject({
    method,
    url: '/api/v1/me',
    headers,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

describe('GET /api/v1/me', () => {
  it('sin token devuelve 401', async () => {
    const response = await request('GET', undefined, false);

    expect(response.statusCode).toBe(401);
  });

  it('devuelve el perfil, las identidades vinculadas y las membresías', async () => {
    const response = await request('GET');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: TEST_USER.sub,
      email: TEST_USER.email,
      displayName: null,
      avatarUrl: null,
      createdAt: ISO_DATE,
      identities: [{ provider: 'google', createdAt: ISO_DATE }],
      // Los presupuestos llegan en la Fase 3 (BudgetMember).
      memberships: [],
    });
  });
});

describe('PATCH /api/v1/me', () => {
  it('actualiza displayName y avatarUrl y devuelve el perfil actualizado', async () => {
    const response = await request('PATCH', {
      displayName: 'Ana García',
      avatarUrl: 'https://cdn.example.com/ana.png',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: TEST_USER.sub,
      displayName: 'Ana García',
      avatarUrl: 'https://cdn.example.com/ana.png',
    });
    await expect(
      testPrisma.user.findUnique({
        where: { id: TEST_USER.sub },
        select: { displayName: true, avatarUrl: true },
      }),
    ).resolves.toEqual({ displayName: 'Ana García', avatarUrl: 'https://cdn.example.com/ana.png' });
  });

  it('una actualización parcial no toca los demás campos', async () => {
    await request('PATCH', { displayName: 'Ana', avatarUrl: 'https://cdn.example.com/ana.png' });

    const response = await request('PATCH', { displayName: 'Ana G.' });

    expect(response.json()).toMatchObject({
      displayName: 'Ana G.',
      avatarUrl: 'https://cdn.example.com/ana.png',
    });
  });

  it('null borra el valor', async () => {
    await request('PATCH', { displayName: 'Ana' });

    const response = await request('PATCH', { displayName: null });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ displayName: null });
  });

  it.each([
    ['email', { email: 'otro@example.com' }],
    ['id', { id: '9b2f6a1e-0c4d-4e8f-a1b2-c3d4e5f60718' }],
    ['createdAt', { createdAt: '2020-01-01T00:00:00.000Z' }],
    ['un campo permitido junto a uno prohibido', { displayName: 'Ana', email: 'otro@example.com' }],
  ])('rechaza con 400 campos no permitidos: %s', async (_case, payload) => {
    const response = await request('PATCH', payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await expect(
      testPrisma.user.findUnique({
        where: { id: TEST_USER.sub },
        select: { email: true, displayName: true },
      }),
    ).resolves.toEqual({ email: TEST_USER.email, displayName: null });
  });

  it.each([
    ['cuerpo vacío', {}],
    ['displayName vacío', { displayName: '' }],
    ['displayName solo con espacios', { displayName: '   ' }],
    ['displayName de más de 50 caracteres', { displayName: 'a'.repeat(51) }],
    ['displayName que no es texto', { displayName: 42 }],
    ['avatarUrl que no es una URL', { avatarUrl: 'no-es-una-url' }],
    ['avatarUrl sin https', { avatarUrl: 'http://cdn.example.com/ana.png' }],
  ])('rechaza con 400 valores inválidos: %s', async (_case, payload) => {
    const response = await request('PATCH', payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('sin token devuelve 401', async () => {
    const response = await request('PATCH', { displayName: 'Ana' }, false);

    expect(response.statusCode).toBe(401);
  });
});

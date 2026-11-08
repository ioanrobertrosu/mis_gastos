import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testPrisma } from '../helpers/db.js';
import { syncUser } from '../../src/modules/users/user-sync.js';
import { signTestToken, TEST_AUTH, TEST_USER, type TestTokenOptions } from '../helpers/jwt.js';
import { QueryCounter } from '../helpers/query-count.js';

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
  app.get('/privada', { preHandler: app.authenticate }, async (request) => request.user);
});

async function login(options: TestTokenOptions = {}) {
  const token = await signTestToken(options);
  return app.inject({
    method: 'GET',
    url: '/privada',
    headers: { authorization: `Bearer ${token}` },
  });
}

async function counts() {
  return { users: await testPrisma.user.count(), identities: await testPrisma.identity.count() };
}

describe('sincronización del usuario al autenticarse', () => {
  it('el primer acceso crea el User con id = sub y su Identity', async () => {
    const response = await login();

    expect(response.statusCode).toBe(200);
    const user = await testPrisma.user.findUnique({
      where: { id: TEST_USER.sub },
      include: { identities: true },
    });
    expect(user).toMatchObject({
      id: TEST_USER.sub,
      email: TEST_USER.email,
      identities: [{ provider: 'google', providerId: TEST_USER.providerId }],
    });
  });

  it('los accesos posteriores reutilizan el mismo User sin duplicar nada', async () => {
    await login();
    const before = await testPrisma.user.findUniqueOrThrow({ where: { id: TEST_USER.sub } });

    const response = await login();

    expect(response.statusCode).toBe(200);
    await expect(counts()).resolves.toEqual({ users: 1, identities: 1 });
    const after = await testPrisma.user.findUniqueOrThrow({ where: { id: TEST_USER.sub } });
    expect(after.createdAt).toEqual(before.createdAt);
  });

  it('varios primeros accesos simultáneos no fallan ni crean duplicados', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => login()));

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200]);
    await expect(counts()).resolves.toEqual({ users: 1, identities: 1 });
  });

  it('un nuevo proveedor añade otra Identity al mismo User', async () => {
    await login();

    const response = await login({
      provider: 'apple',
      userMetadata: { provider_id: 'apple-000123' },
    });

    expect(response.statusCode).toBe(200);
    await expect(counts()).resolves.toEqual({ users: 1, identities: 2 });
    await expect(
      testPrisma.identity.findMany({
        where: { userId: TEST_USER.sub },
        select: { provider: true },
        orderBy: { provider: 'asc' },
      }),
    ).resolves.toEqual([{ provider: 'apple' }, { provider: 'google' }]);
  });

  it('sin provider_id en user_metadata usa el sub como providerId (login por email)', async () => {
    await login({ provider: 'email', userMetadata: {} });

    await expect(testPrisma.identity.findFirst()).resolves.toMatchObject({
      provider: 'email',
      providerId: TEST_USER.sub,
    });
  });

  it('sin app_metadata.provider registra la identidad como "email"', async () => {
    await login({ provider: null, userMetadata: {} });

    await expect(testPrisma.identity.findFirst()).resolves.toMatchObject({
      provider: 'email',
      providerId: TEST_USER.sub,
    });
  });

  it('un usuario nuevo sin email recibe 403 y no se crea nada', async () => {
    const response = await login({ email: null });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: 'FORBIDDEN', message: expect.any(String) },
    });
    await expect(counts()).resolves.toEqual({ users: 0, identities: 0 });
  });

  it('un email que ya pertenece a otro User devuelve 409 y no crea nada', async () => {
    await testPrisma.user.create({
      data: { id: '9b2f6a1e-0c4d-4e8f-a1b2-c3d4e5f60718', email: TEST_USER.email },
    });

    const response = await login();

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'CONFLICT', message: expect.any(String) },
    });
    await expect(counts()).resolves.toEqual({ users: 1, identities: 0 });
  });

  // Se ejecuta en cada petición autenticada: cada consulta es un viaje de ida y vuelta a la BD.
  it('con la identidad ya registrada, la comprobación es una sola consulta', async () => {
    expect((await login()).statusCode).toBe(200);
    const counter = new QueryCounter();

    await syncUser(counter.prisma, {
      sub: TEST_USER.sub,
      email: TEST_USER.email,
      provider: 'google',
      providerId: TEST_USER.providerId,
    });

    expect(counter.queries).toHaveLength(1);
  });
});

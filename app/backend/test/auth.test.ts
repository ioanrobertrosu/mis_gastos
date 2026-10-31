import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { fakePrisma } from './helpers/fake-prisma.js';
import { signTestToken, TEST_AUTH, TEST_USER, unsignedToken } from './helpers/jwt.js';

let app: FastifyInstance;
let prisma: PrismaClient;
const handler = vi.fn(async (request: { user: unknown }) => request.user);

beforeEach(async () => {
  handler.mockClear();
  prisma = fakePrisma();
  app = await buildApp({ prisma, auth: TEST_AUTH });
  app.get('/privada', { preHandler: app.authenticate }, handler);
});

afterEach(async () => {
  await app.close();
});

function get(authorization?: string) {
  return app.inject({
    method: 'GET',
    url: '/privada',
    headers: authorization === undefined ? {} : { authorization },
  });
}

async function expectUnauthorized(authorization?: string) {
  const response = await get(authorization);

  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({
    error: { code: 'UNAUTHORIZED', message: expect.any(String) },
  });
  expect(handler).not.toHaveBeenCalled();
}

describe('autenticación por JWT de Supabase', () => {
  it('rechaza con 401 una petición sin cabecera Authorization', async () => {
    await expectUnauthorized();
  });

  it('rechaza un esquema distinto de Bearer', async () => {
    await expectUnauthorized(`Basic ${Buffer.from('ana:1234').toString('base64')}`);
  });

  it('rechaza un token mal formado', async () => {
    await expectUnauthorized('Bearer no-es-un-jwt');
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const token = await signTestToken({ secret: 'otro-secreto-de-al-menos-32-caracteres!!' });
    await expectUnauthorized(`Bearer ${token}`);
  });

  it('rechaza un token sin firmar (alg: none)', async () => {
    await expectUnauthorized(`Bearer ${unsignedToken()}`);
  });

  it('rechaza un token con un issuer distinto', async () => {
    const token = await signTestToken({ issuer: 'https://otro-proyecto.supabase.co/auth/v1' });
    await expectUnauthorized(`Bearer ${token}`);
  });

  it('rechaza un token con una audience distinta', async () => {
    const token = await signTestToken({ audience: 'anon' });
    await expectUnauthorized(`Bearer ${token}`);
  });

  it('rechaza un token caducado', async () => {
    const token = await signTestToken({ expiresAt: Math.floor(Date.now() / 1000) - 60 });
    await expectUnauthorized(`Bearer ${token}`);
  });

  it('rechaza un token sin sub', async () => {
    const token = await signTestToken({ sub: null });
    await expectUnauthorized(`Bearer ${token}`);
  });

  it('con un token válido expone request.user con sub y email', async () => {
    const token = await signTestToken();

    const response = await get(`Bearer ${token}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sub: TEST_USER.sub, email: TEST_USER.email });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('un usuario ya registrado puede entrar con un token sin email (email undefined)', async () => {
    // Identidad ya existente: el alta (que exige email) no se ejecuta.
    vi.mocked(prisma.identity.findUnique).mockResolvedValueOnce({ id: 'identity-id' } as never);
    const token = await signTestToken({ email: null });

    const response = await get(`Bearer ${token}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sub: TEST_USER.sub });
  });

  it('acepta el esquema Bearer sin distinguir mayúsculas', async () => {
    const token = await signTestToken();

    const response = await get(`bearer ${token}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sub: TEST_USER.sub, email: TEST_USER.email });
  });
});

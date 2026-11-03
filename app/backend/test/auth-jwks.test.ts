import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuthOptions } from '../src/plugins/auth.js';
import { fakePrisma } from './helpers/fake-prisma.js';
import {
  signAsymmetricToken,
  signTestToken,
  TEST_AUTH,
  TEST_USER,
  testKeyPair,
} from './helpers/jwt.js';

type TestKey = Awaited<ReturnType<typeof testKeyPair>>;

let current: TestKey;
let rsa: TestKey;
let outsider: TestKey;
let app: FastifyInstance | undefined;

beforeAll(async () => {
  current = await testKeyPair('ES256', 'clave-actual');
  rsa = await testKeyPair('RS256', 'clave-rsa');
  // Misma `kid` que la actual pero otra clave privada: no está publicada en el JWKS.
  outsider = await testKeyPair('ES256', 'clave-actual');
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function appWith(auth: AuthOptions) {
  app = await buildApp({ prisma: fakePrisma(), auth });
  app.get('/privada', { preHandler: app.authenticate }, (request) => request.user);
  return app;
}

function withJwks(): AuthOptions {
  return { ...TEST_AUTH, jwks: createLocalJWKSet({ keys: [current.jwk, rsa.jwk] }) };
}

async function get(server: FastifyInstance, token: string) {
  return server.inject({
    method: 'GET',
    url: '/privada',
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('autenticación con las nuevas JWT signing keys de Supabase (JWKS)', () => {
  it('acepta un token ES256 firmado con una clave publicada en el JWKS', async () => {
    const server = await appWith(withJwks());

    const response = await get(server, await signAsymmetricToken(current));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sub: TEST_USER.sub, email: TEST_USER.email });
  });

  it('acepta también RS256', async () => {
    const server = await appWith(withJwks());

    const response = await get(server, await signAsymmetricToken(rsa));

    expect(response.statusCode).toBe(200);
  });

  it('sigue aceptando los tokens HS256 del secreto heredado durante la transición', async () => {
    const server = await appWith(withJwks());

    const response = await get(server, await signTestToken());

    expect(response.statusCode).toBe(200);
  });

  it('rechaza un token firmado con una clave que no está en el JWKS', async () => {
    const server = await appWith(withJwks());

    const response = await get(server, await signAsymmetricToken(outsider));

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('rechaza un token con una kid desconocida', async () => {
    const server = await appWith(withJwks());

    const response = await get(server, await signAsymmetricToken(current, { kid: 'otra-kid' }));

    expect(response.statusCode).toBe(401);
  });

  it('aplica issuer y audience también a los tokens asimétricos', async () => {
    const server = await appWith(withJwks());

    const wrongIssuer = await signAsymmetricToken(current, {
      issuer: 'https://otro-proyecto.supabase.co/auth/v1',
    });
    const wrongAudience = await signAsymmetricToken(current, { audience: 'anon' });

    expect((await get(server, wrongIssuer)).statusCode).toBe(401);
    expect((await get(server, wrongAudience)).statusCode).toBe(401);
  });

  it('rechaza la confusión de algoritmo: HS256 firmado con la clave pública como secreto', async () => {
    const server = await appWith(withJwks());
    const forged = await new SignJWT({ email: TEST_USER.email })
      .setProtectedHeader({ alg: 'HS256', kid: current.kid })
      .setSubject(TEST_USER.sub)
      .setIssuer(TEST_AUTH.issuer)
      .setAudience(TEST_AUTH.audience)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(JSON.stringify(current.jwk)));

    const response = await get(server, forged);

    expect(response.statusCode).toBe(401);
  });

  it('si no se puede obtener el JWKS, responde 401 (no 500) y lo registra', async () => {
    const jwks = vi.fn(async () => {
      throw new Error('JWKS no disponible');
    });
    const server = await appWith({ ...TEST_AUTH, jwks });

    const response = await get(server, await signAsymmetricToken(current));

    expect(response.statusCode).toBe(401);
    expect(jwks).toHaveBeenCalled();
  });

  it('sin JWKS configurado, un token asimétrico se rechaza', async () => {
    const server = await appWith(TEST_AUTH);

    const response = await get(server, await signAsymmetricToken(current));

    expect(response.statusCode).toBe(401);
  });
});

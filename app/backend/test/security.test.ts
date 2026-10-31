import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type BuildAppOptions } from '../src/app.js';
import { fakePrisma } from './helpers/fake-prisma.js';

const ALLOWED_ORIGIN = 'http://localhost:8081';

let app: FastifyInstance | undefined;

async function createApp(options: Partial<BuildAppOptions> = {}): Promise<FastifyInstance> {
  app = await buildApp({ prisma: fakePrisma(), ...options });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('cabeceras de seguridad (helmet)', () => {
  it('añade las cabeceras de seguridad estándar', async () => {
    const response = await (await createApp()).inject({ method: 'GET', url: '/health' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBeDefined();
  });
});

describe('CORS', () => {
  it('permite los orígenes configurados', async () => {
    const response = await (
      await createApp({ corsOrigins: [ALLOWED_ORIGIN] })
    ).inject({
      method: 'GET',
      url: '/health',
      headers: { origin: ALLOWED_ORIGIN },
    });

    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('no permite orígenes no configurados', async () => {
    const response = await (
      await createApp({ corsOrigins: [ALLOWED_ORIGIN] })
    ).inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://malicioso.example' },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sin orígenes configurados no permite ninguno', async () => {
    const response = await (
      await createApp()
    ).inject({
      method: 'GET',
      url: '/health',
      headers: { origin: ALLOWED_ORIGIN },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('el preflight admite PATCH/DELETE y la cabecera Authorization', async () => {
    const response = await (
      await createApp({ corsOrigins: [ALLOWED_ORIGIN] })
    ).inject({
      method: 'OPTIONS',
      url: '/api/v1/budgets',
      headers: {
        origin: ALLOWED_ORIGIN,
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-methods']).toEqual(
      expect.stringContaining('PATCH'),
    );
    expect(response.headers['access-control-allow-methods']).toEqual(
      expect.stringContaining('DELETE'),
    );
    expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'authorization',
    );
  });
});

describe('rate limit', () => {
  it('las rutas que lo activan responden 429 con el formato uniforme al superar el límite', async () => {
    const instance = await createApp();
    instance.get(
      '/limitada',
      { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } },
      async () => ({ ok: true }),
    );

    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 3; i++) {
      last = await instance.inject({ method: 'GET', url: '/limitada' });
      statuses.push(last.statusCode);
    }

    expect(statuses).toEqual([200, 200, 429]);
    expect(last?.headers['retry-after']).toBeDefined();
    expect(last?.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: expect.any(String) },
    });
  });

  it('no limita las rutas que no lo activan', async () => {
    const instance = await createApp();

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await instance.inject({ method: 'GET', url: '/health' })).statusCode);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200]);
  });
});

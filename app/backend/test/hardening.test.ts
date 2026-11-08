import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../src/app.js';
import { fakePrisma } from './helpers/fake-prisma.js';
import { TEST_AUTH } from './helpers/jwt.js';
import { ANA, authHeader, BEA } from './helpers/users.js';
import { TestClients } from './helpers/ws.js';

let app: FastifyInstance | undefined;
let clients: TestClients | undefined;

afterEach(async () => {
  clients?.closeAll();
  clients = undefined;
  await app?.close();
  app = undefined;
});

async function build(options: Partial<BuildAppOptions> = {}) {
  const prisma = fakePrisma();
  vi.mocked(prisma.user.findFirst).mockResolvedValue({ deletedAt: null } as never);
  app = await buildApp({ auth: TEST_AUTH, prisma, ...options });
  return app;
}

async function listening(options: Partial<BuildAppOptions> = {}) {
  const server = await build(options);
  await server.listen({ port: 0, host: '127.0.0.1' });
  clients = new TestClients(server);
  return clients;
}

describe('límite global de peticiones', () => {
  it('por encima del máximo responde 429 con el formato de error de la API', async () => {
    const server = await build({ rateLimitMax: 3 });
    const get = () => server.inject({ method: 'GET', url: '/api/v1/me' });

    const allowed = [await get(), await get(), await get()];
    const blocked = await get();

    expect(allowed.map((response) => response.statusCode)).toEqual([401, 401, 401]);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: expect.any(String) },
    });
  });

  it('por defecto admite 300 peticiones por minuto', async () => {
    const server = await build();

    // En serie: si una ráfaga simultánea supera el máximo, el plugin la rechaza entera (lee el
    // contador compartido tras un `await`). Es por el lado seguro: nunca deja pasar de más.
    const statuses: number[] = [];
    for (let i = 0; i < 301; i++) {
      statuses.push((await server.inject({ method: 'GET', url: '/api/v1/me' })).statusCode);
    }

    expect(statuses.filter((status) => status === 401)).toHaveLength(300);
    expect(statuses.at(-1)).toBe(429);
  });

  it('cada IP tiene su propio contador', async () => {
    const server = await build({ rateLimitMax: 1 });
    const from = (remoteAddress: string) =>
      server.inject({ method: 'GET', url: '/api/v1/me', remoteAddress });

    await from('203.0.113.1');

    expect((await from('203.0.113.1')).statusCode).toBe(429);
    expect((await from('203.0.113.2')).statusCode).toBe(401);
  });

  it('/health no está limitado: lo usa el healthcheck de Docker', async () => {
    const server = await build({ rateLimitMax: 1 });

    const responses = [
      await server.inject({ method: 'GET', url: '/health' }),
      await server.inject({ method: 'GET', url: '/health' }),
      await server.inject({ method: 'GET', url: '/health' }),
    ];

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
  });
});

describe('IP del cliente tras un proxy', () => {
  function viaProxy(server: FastifyInstance, clientIp: string) {
    return server.inject({
      method: 'GET',
      url: '/api/v1/me',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': clientIp },
    });
  }

  it('sin proxies de confianza, falsificar X-Forwarded-For no esquiva el límite', async () => {
    const server = await build({ rateLimitMax: 1 });

    await viaProxy(server, '203.0.113.1');

    expect((await viaProxy(server, '203.0.113.2')).statusCode).toBe(429);
  });

  it('con proxies de confianza, cada cliente real tiene su contador aunque comparta proxy', async () => {
    const server = await build({ rateLimitMax: 1, trustedProxies: 1 });

    await viaProxy(server, '203.0.113.1');

    expect((await viaProxy(server, '203.0.113.1')).statusCode).toBe(429);
    expect((await viaProxy(server, '203.0.113.2')).statusCode).toBe(401);
  });
});

describe('tamaño máximo del body', () => {
  async function patchMe(server: FastifyInstance, bytes: number) {
    return server.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { ...(await authHeader(ANA)), 'content-type': 'application/json' },
      payload: JSON.stringify({ displayName: 'a'.repeat(bytes) }),
    });
  }

  it('por encima de 64 KB responde 413 con el formato de error de la API', async () => {
    const server = await build();

    const response = await patchMe(server, 65 * 1024);

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
  });

  it('por debajo no se rechaza por tamaño (lo rechaza la validación)', async () => {
    const server = await build();

    const response = await patchMe(server, 60 * 1024);

    expect(response.statusCode).toBe(400);
  });
});

describe('límites de WebSocket', () => {
  it('admite 5 conexiones por usuario; la sexta se cierra con 4429', async () => {
    const pool = await listening();
    const headers = await authHeader(ANA);
    const allowed = [];
    for (let i = 0; i < 5; i++) allowed.push(await pool.connect(headers));

    const sixth = await pool.connect(headers);

    await expect(sixth.closeCode(3_000)).resolves.toBe(4429);
    expect(allowed.every((client) => client.isOpen)).toBe(true);
    expect(app?.realtime.connectionCount).toBe(5);
  });

  it('el límite es por usuario: otro usuario sí puede conectarse', async () => {
    const pool = await listening();
    const headers = await authHeader(ANA);
    for (let i = 0; i < 5; i++) await pool.connect(headers);

    const other = await pool.connect(await authHeader(BEA));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(other.isOpen).toBe(true);
  });

  it('al cerrar una conexión se libera su hueco', async () => {
    const pool = await listening();
    const headers = await authHeader(ANA);
    const clientsOpen = [];
    for (let i = 0; i < 5; i++) clientsOpen.push(await pool.connect(headers));
    clientsOpen[0]?.socket.close();
    await vi.waitFor(() => expect(app?.realtime.connectionCount).toBe(4));

    const replacement = await pool.connect(headers);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(replacement.isOpen).toBe(true);
  });

  it('más de 20 mensajes en 10 s cierran la conexión con 4429', async () => {
    const pool = await listening();
    const client = await pool.connect(await authHeader(ANA));

    for (let i = 0; i < 21; i++) client.send('mensaje inválido');

    await expect(client.closeCode(3_000)).resolves.toBe(4429);
  });

  it('20 mensajes se procesan con normalidad', async () => {
    const pool = await listening();
    const client = await pool.connect(await authHeader(ANA));

    for (let i = 0; i < 20; i++) client.send('mensaje inválido');
    for (let i = 0; i < 20; i++) {
      await expect(client.next()).resolves.toEqual({ type: 'error', code: 'INVALID_MESSAGE' });
    }

    expect(client.isOpen).toBe(true);
  });
});

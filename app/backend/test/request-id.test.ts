import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { buildLoggerOptions } from '../src/config/logger.js';
import { fakePrisma } from './helpers/fake-prisma.js';
import { TEST_AUTH } from './helpers/jwt.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function build() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  app = await buildApp({
    auth: TEST_AUTH,
    prisma: fakePrisma(),
    logger: { ...buildLoggerOptions('production'), stream },
  });
  return { app, logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

describe('x-request-id', () => {
  it('sin cabecera genera un UUID y lo devuelve en la respuesta', async () => {
    const { app: server } = await build();

    const first = await server.inject({ method: 'GET', url: '/health' });
    const second = await server.inject({ method: 'GET', url: '/health' });

    expect(first.headers['x-request-id']).toMatch(UUID);
    expect(second.headers['x-request-id']).toMatch(UUID);
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('reutiliza un id válido enviado por el proxy', async () => {
    const { app: server } = await build();

    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'proxy-abc_123.XYZ' },
    });

    expect(response.headers['x-request-id']).toBe('proxy-abc_123.XYZ');
  });

  it.each([
    ['con salto de línea (inyección en logs)', 'abc\\n{"level":"fatal"}'],
    ['con espacios', 'abc def'],
    ['con caracteres no permitidos', 'abc<script>'],
    ['demasiado largo', 'a'.repeat(129)],
    ['vacío', ''],
  ])('sustituye un id inválido: %s', async (_case, value) => {
    const { app: server } = await build();

    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': value },
    });

    expect(response.headers['x-request-id']).toMatch(UUID);
  });

  it('también aparece en errores y en rutas inexistentes', async () => {
    const { app: server } = await build();

    const unauthorized = await server.inject({ method: 'GET', url: '/api/v1/me' });
    const missing = await server.inject({ method: 'GET', url: '/no-existe' });

    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers['x-request-id']).toMatch(UUID);
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['x-request-id']).toMatch(UUID);
  });

  it('los logs de la petición llevan el mismo id que la respuesta', async () => {
    const { app: server, logs } = await build();

    const response = await server.inject({ method: 'GET', url: '/health' });

    const requestLogs = logs().filter((line) => 'reqId' in line);
    expect(requestLogs.length).toBeGreaterThan(0);
    expect(requestLogs.every((line) => line.reqId === response.headers['x-request-id'])).toBe(true);
  });

  it('un id enviado por el proxy se usa también en los logs', async () => {
    const { app: server, logs } = await build();

    await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'proxy-1' },
    });

    expect(
      logs()
        .filter((line) => 'reqId' in line)
        .every((line) => line.reqId === 'proxy-1'),
    ).toBe(true);
    expect(logs().some((line) => line.reqId === 'proxy-1')).toBe(true);
  });
});

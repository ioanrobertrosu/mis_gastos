import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { fakePrisma } from './helpers/fake-prisma.js';

describe('GET /health', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('responde 200 con db "up" cuando Prisma responde a SELECT 1', async () => {
    const prisma = fakePrisma();
    app = await buildApp({ prisma });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', db: 'up' });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it('responde 503 con db "down" cuando la consulta a la BD falla', async () => {
    const prisma = fakePrisma(async () => {
      throw new Error('connection refused');
    });
    app = await buildApp({ prisma });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'error', db: 'down' });
  });
});

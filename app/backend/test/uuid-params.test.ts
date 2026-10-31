import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { IdParamsSchema } from '../src/shared/schemas.js';
import { fakePrisma } from './helpers/fake-prisma.js';

describe('esquema reutilizable de parámetros UUID', () => {
  let app: FastifyInstance;
  const prisma = fakePrisma();
  const handler = vi.fn(async () => ({ ok: true }));

  beforeEach(async () => {
    handler.mockClear();
    app = await buildApp({ prisma });
    app.get('/items/:id', { schema: { params: IdParamsSchema } }, handler);
  });

  afterEach(async () => {
    await app.close();
  });

  it('un :id que no es UUID devuelve 400 sin ejecutar el handler ni llegar a Prisma', async () => {
    const response = await app.inject({ method: 'GET', url: '/items/no-es-un-uuid' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.stringContaining('id') },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('un :id con forma de UUID pero longitud incorrecta también se rechaza', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/items/123e4567-e89b-42d3-a456-42661417400',
    });

    expect(response.statusCode).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('un :id UUID válido llega al handler', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/items/123e4567-e89b-42d3-a456-426614174000',
    });

    expect(response.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});

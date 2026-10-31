import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type BuildAppOptions } from '../src/app.js';
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
} from '../src/shared/errors.js';
import { fakePrisma } from './helpers/fake-prisma.js';

let app: FastifyInstance | undefined;

async function appThrowing(
  error: unknown,
  options: Partial<BuildAppOptions> = {},
): Promise<FastifyInstance> {
  app = await buildApp({ prisma: fakePrisma(), ...options });
  app.get('/boom', async () => {
    throw error;
  });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('manejador de errores', () => {
  it.each([
    [new NotFoundError('Presupuesto no encontrado'), 404, 'NOT_FOUND', 'Presupuesto no encontrado'],
    [new ForbiddenError('Sin permiso'), 403, 'FORBIDDEN', 'Sin permiso'],
    [new ConflictError('Ya existe'), 409, 'CONFLICT', 'Ya existe'],
    [
      new LimitExceededError('Máximo 3 presupuestos'),
      422,
      'LIMIT_EXCEEDED',
      'Máximo 3 presupuestos',
    ],
  ])('traduce %o a %i con código %s', async (error, statusCode, code, message) => {
    const response = await (await appThrowing(error)).inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toEqual({ error: { code, message } });
  });

  it('los errores de dominio tienen un mensaje por defecto', async () => {
    const response = await (
      await appThrowing(new NotFoundError())
    ).inject({
      method: 'GET',
      url: '/boom',
    });

    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Recurso no encontrado' },
    });
  });

  it('un error inesperado devuelve 500 genérico sin filtrar detalles por defecto (producción)', async () => {
    const response = await (
      await appThrowing(new Error('secreto: fallo en la consulta'))
    ).inject({
      method: 'GET',
      url: '/boom',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
    });
    expect(response.body).not.toContain('secreto');
    expect(response.body).not.toContain('at ');
  });

  it('con exposeInternalErrors muestra el mensaje original, pero nunca el stack', async () => {
    const response = await (
      await appThrowing(new Error('fallo en la consulta'), { exposeInternalErrors: true })
    ).inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'fallo en la consulta' },
    });
  });

  it('los errores de validación de esquema devuelven 400 con código VALIDATION_ERROR', async () => {
    app = await buildApp({ prisma: fakePrisma() });
    app.post(
      '/echo',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
        },
      },
      async (request) => request.body,
    );

    const response = await app.inject({ method: 'POST', url: '/echo', payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.stringContaining('name') },
    });
  });

  it('un body JSON mal formado devuelve 400 con el formato uniforme', async () => {
    app = await buildApp({ prisma: fakePrisma() });
    app.post('/echo', async (request) => request.body);

    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"name": ',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
  });

  it('una ruta inexistente devuelve 404 con el formato uniforme', async () => {
    app = await buildApp({ prisma: fakePrisma() });

    const response = await app.inject({ method: 'GET', url: '/no-existe' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Ruta GET /no-existe no encontrada' },
    });
  });
});

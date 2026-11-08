import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { ErrorReporter } from '../src/config/error-reporter.js';
import { NotFoundError } from '../src/shared/errors.js';
import { fakePrisma } from './helpers/fake-prisma.js';
import { signTestToken, TEST_AUTH, TEST_USER } from './helpers/jwt.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function fakeReporter() {
  return { captureException: vi.fn<ErrorReporter['captureException']>() };
}

async function appWith(reporter: ErrorReporter, error: unknown = new Error('fallo de la BD')) {
  app = await buildApp({ auth: TEST_AUTH, prisma: fakePrisma(), errorReporter: reporter });
  app.get('/boom', async () => {
    throw error;
  });
  app.get('/boom-auth', { preHandler: app.authenticate }, async () => {
    throw error;
  });
  app.post(
    '/echo',
    { schema: { body: { type: 'object', properties: { n: { type: 'integer' } } } } },
    async (request) => request.body,
  );
  return app;
}

describe('notificación de errores (Sentry)', () => {
  it('un error inesperado se notifica una vez, con el id de petición, la ruta y el método', async () => {
    const reporter = fakeReporter();
    const error = new Error('fallo de la BD');
    await appWith(reporter, error);

    const response = await app!.inject({ method: 'GET', url: '/boom?x=1' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
    });
    expect(reporter.captureException).toHaveBeenCalledOnce();
    expect(reporter.captureException).toHaveBeenCalledWith(error, {
      requestId: response.headers['x-request-id'],
      method: 'GET',
      route: '/boom',
      userId: undefined,
    });
  });

  it('en una ruta autenticada incluye el id del usuario (nunca su email ni el token)', async () => {
    const reporter = fakeReporter();
    await appWith(reporter);
    const token = await signTestToken();

    await app!.inject({
      method: 'GET',
      url: '/boom-auth',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(reporter.captureException).toHaveBeenCalledWith(expect.any(Error), {
      requestId: expect.any(String),
      method: 'GET',
      route: '/boom-auth',
      userId: TEST_USER.sub,
    });
  });

  it.each([
    ['un error de dominio (404)', '/boom-domain', 'GET', undefined],
    ['un body inválido (400)', '/echo', 'POST', { n: 'no-es-un-numero' }],
    ['un JSON mal formado (400)', '/echo', 'POST', '{"n":'],
    ['una ruta inexistente (404)', '/no-existe', 'GET', undefined],
    ['una petición sin token (401)', '/boom-auth', 'GET', undefined],
  ])('no se notifica %s', async (_case, url, method, payload) => {
    const reporter = fakeReporter();
    await appWith(reporter);
    app!.get('/boom-domain', async () => {
      throw new NotFoundError('Meta no encontrada');
    });

    const response = await app!.inject({
      method: method as 'GET' | 'POST',
      url,
      ...(payload === undefined
        ? {}
        : { payload, headers: { 'content-type': 'application/json' } }),
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(reporter.captureException).not.toHaveBeenCalled();
  });

  it('si la notificación falla, la respuesta sigue siendo el 500 uniforme', async () => {
    const reporter = fakeReporter();
    reporter.captureException.mockImplementation(() => {
      throw new Error('Sentry caído');
    });
    await appWith(reporter);

    const response = await app!.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
    });
  });
});

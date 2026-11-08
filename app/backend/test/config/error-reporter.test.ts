import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it, vi } from 'vitest';
import {
  createErrorReporter,
  DATA_COLLECTION,
  NOOP_ERROR_REPORTER,
  scrubEvent,
  type SentryClient,
} from '../../src/config/error-reporter.js';

function fakeSentry() {
  return { init: vi.fn(), captureException: vi.fn() } satisfies SentryClient;
}

const CONTEXT = { requestId: 'req-1', method: 'GET', route: '/api/v1/me', userId: 'user-1' };

describe('createErrorReporter', () => {
  it('sin DSN no inicializa Sentry y no notifica nada', () => {
    const sentry = fakeSentry();

    const reporter = createErrorReporter({ environment: 'production', release: 'r1' }, sentry);
    reporter.captureException(new Error('x'), CONTEXT);

    expect(reporter).toBe(NOOP_ERROR_REPORTER);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('con DSN inicializa Sentry con entorno y release, sin datos personales ni trazas', () => {
    const sentry = fakeSentry();

    createErrorReporter(
      { dsn: 'https://key@o1.ingest.sentry.io/1', environment: 'production', release: 'r1' },
      sentry,
    );

    expect(sentry.init).toHaveBeenCalledOnce();
    expect(sentry.init).toHaveBeenCalledWith({
      dsn: 'https://key@o1.ingest.sentry.io/1',
      environment: 'production',
      release: 'r1',
      dataCollection: DATA_COLLECTION,
      tracesSampleRate: 0,
      beforeSend: scrubEvent,
      integrations: expect.any(Function),
    });
  });

  it('quita la captura automática de Fastify (sin etiquetas ni usuario, y anula la nuestra por duplicada) y las variables locales', () => {
    const sentry = fakeSentry();
    createErrorReporter(
      { dsn: 'https://key@o1.ingest.sentry.io/1', environment: 'production', release: 'r1' },
      sentry,
    );
    const { integrations } = sentry.init.mock.calls[0]![0] as {
      integrations: (defaults: { name: string }[]) => { name: string }[];
    };

    const kept = integrations([
      { name: 'Http' },
      { name: 'Fastify' },
      { name: 'LocalVariablesAsync' },
      { name: 'LocalVariables' },
      { name: 'OnUnhandledRejection' },
    ]);

    expect(kept.map(({ name }) => name)).toEqual(['Http', 'OnUnhandledRejection']);
  });

  it('no recoge usuarios automáticos, cookies, query, cuerpos ni cabeceras con credenciales', () => {
    expect(DATA_COLLECTION).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: ['authorization', 'cookie', 'sec-websocket-protocol'] },
        response: false,
      },
      httpBodies: [],
      urlQueryParams: false,
    });
  });

  it('notifica el error con el id de petición, el método y la ruta como etiquetas, y el usuario por id', () => {
    const sentry = fakeSentry();
    const reporter = createErrorReporter(
      { dsn: 'https://key@o1.ingest.sentry.io/1', environment: 'production', release: 'r1' },
      sentry,
    );
    const error = new Error('fallo');

    reporter.captureException(error, CONTEXT);

    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { requestId: 'req-1', method: 'GET', route: '/api/v1/me' },
      user: { id: 'user-1' },
    });
  });

  it('sin usuario autenticado no envía user', () => {
    const sentry = fakeSentry();
    const reporter = createErrorReporter(
      { dsn: 'https://key@o1.ingest.sentry.io/1', environment: 'production', release: 'r1' },
      sentry,
    );

    reporter.captureException(new Error('fallo'), { ...CONTEXT, userId: undefined });

    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { requestId: 'req-1', method: 'GET', route: '/api/v1/me' },
    });
  });
});

describe('scrubEvent', () => {
  it('quita de la petición las cabeceras con credenciales, las cookies y la query', () => {
    const event: ErrorEvent = {
      type: undefined,
      message: 'fallo',
      request: {
        url: 'https://mis-gastos.duckdns.org/api/v1/me',
        method: 'GET',
        query_string: 'token=secreto',
        cookies: { session: 'secreto' },
        headers: {
          Authorization: 'Bearer secreto',
          cookie: 'session=secreto',
          'sec-websocket-protocol': 'bearer, secreto',
          'x-request-id': 'req-1',
          'user-agent': 'app/1.0',
        },
      },
    };

    expect(scrubEvent(event)).toEqual({
      type: undefined,
      message: 'fallo',
      request: {
        url: 'https://mis-gastos.duckdns.org/api/v1/me',
        method: 'GET',
        headers: { 'x-request-id': 'req-1', 'user-agent': 'app/1.0' },
      },
    });
  });

  it('deja intacto un evento sin petición', () => {
    const event: ErrorEvent = { type: undefined, message: 'fallo' };
    expect(scrubEvent(event)).toEqual(event);
  });
});

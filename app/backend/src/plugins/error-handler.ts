import type { FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import type { ErrorReporter } from '../config/error-reporter.js';
import { DomainError } from '../shared/errors.js';
import type { AuthUser } from './auth.js';

export interface ErrorHandlerOptions {
  /** Muestra el mensaje original de los errores 500 (solo fuera de producción). */
  exposeInternalErrors: boolean;
  /** Recibe solo los errores inesperados (500), no los 4xx. */
  errorReporter: ErrorReporter;
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export const errorHandlerPlugin = fp<ErrorHandlerOptions>(
  async (app, { exposeInternalErrors, errorReporter }) => {
    app.setNotFoundHandler((request, reply) => {
      reply
        .code(404)
        .send(errorBody('NOT_FOUND', `Ruta ${request.method} ${request.url} no encontrada`));
    });

    app.setErrorHandler<FastifyError>((error, request, reply) => {
      if (error instanceof DomainError) {
        return reply.code(error.statusCode).send(errorBody(error.code, error.message));
      }

      if (error.validation) {
        return reply.code(400).send(errorBody('VALIDATION_ERROR', error.message));
      }

      // Errores 4xx de Fastify o sus plugins (JSON mal formado, body demasiado grande…).
      const { statusCode } = error;
      if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
        return reply.code(statusCode).send(errorBody(error.code ?? 'BAD_REQUEST', error.message));
      }

      request.log.error({ err: error }, 'Error no controlado');
      try {
        errorReporter.captureException(error, {
          requestId: request.id,
          method: request.method,
          route: request.routeOptions.url,
          // `null` sin autenticar (el decorador lo inicializa así), aunque el tipo no lo refleje.
          userId: (request.user as AuthUser | null)?.sub,
        });
      } catch (reportError) {
        // Notificar nunca debe cambiar la respuesta al cliente.
        request.log.error({ err: reportError }, 'No se pudo notificar el error');
      }
      const message = exposeInternalErrors ? error.message : 'Error interno del servidor';
      return reply.code(500).send(errorBody('INTERNAL_ERROR', message));
    });
  },
  { name: 'error-handler' },
);

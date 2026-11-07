import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import { RateLimitedError } from '../shared/errors.js';

export interface SecurityOptions {
  /** Orígenes permitidos por CORS; vacío = ninguno (las apps nativas no usan CORS). */
  corsOrigins: string[];
  /** Peticiones por minuto e IP en toda la API. */
  rateLimitMax: number;
}

export const securityPlugin = fp<SecurityOptions>(
  async (app, { corsOrigins, rateLimitMax }) => {
    await app.register(helmet);

    await app.register(cors, {
      origin: corsOrigins,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    });

    // Límite global por IP, en `onRequest`: antes de `authenticate` (`preParsing`), así que los
    // tokens inválidos también cuentan. Las rutas sensibles lo endurecen con `config.rateLimit`.
    await app.register(rateLimit, {
      global: true,
      max: rateLimitMax,
      timeWindow: '1 minute',
      errorResponseBuilder: (_request, context) =>
        new RateLimitedError(`Demasiadas peticiones, inténtalo de nuevo en ${context.after}`),
    });
  },
  { name: 'security' },
);

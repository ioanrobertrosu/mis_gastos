import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import { RateLimitedError } from '../shared/errors.js';

export interface SecurityOptions {
  /** Orígenes permitidos por CORS; vacío = ninguno (las apps nativas no usan CORS). */
  corsOrigins: string[];
}

export const securityPlugin = fp<SecurityOptions>(
  async (app, { corsOrigins }) => {
    await app.register(helmet);

    await app.register(cors, {
      origin: corsOrigins,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    });

    // Desactivado globalmente: cada ruta pública o de invitación lo activa con `config.rateLimit`.
    await app.register(rateLimit, {
      global: false,
      errorResponseBuilder: (_request, context) =>
        new RateLimitedError(`Demasiadas peticiones, inténtalo de nuevo en ${context.after}`),
    });
  },
  { name: 'security' },
);

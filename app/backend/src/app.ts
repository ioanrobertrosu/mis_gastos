import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { schemaController } from './config/validation.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { apiRoutes } from './modules/index.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authPlugin, type AuthOptions } from './plugins/auth.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { prismaPlugin } from './plugins/prisma.js';
import { securityPlugin } from './plugins/security.js';

export const API_PREFIX = '/api/v1';

export interface BuildAppOptions extends FastifyServerOptions {
  prisma: PrismaClient;
  /** Verificación de los JWT de Supabase. Obligatoria: no hay app sin autenticación. */
  auth: AuthOptions;
  /** Por defecto `false`: los errores 500 no revelan su mensaje original. */
  exposeInternalErrors?: boolean;
  /** Orígenes permitidos por CORS. Por defecto ninguno. */
  corsOrigins?: string[];
}

export async function buildApp({
  prisma,
  auth,
  exposeInternalErrors = false,
  corsOrigins = [],
  ...options
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ ...options, schemaController });

  await app.register(errorHandlerPlugin, { exposeInternalErrors });
  await app.register(securityPlugin, { corsOrigins });
  await app.register(prismaPlugin, { client: prisma });
  // Antes de cualquier ruta: un `preHandler: app.authenticate` indefinido dejaría la ruta pública.
  await app.register(authPlugin, auth);

  // /health queda fuera del prefijo: lo consume el healthcheck de Docker.
  await app.register(healthRoutes);
  await app.register(apiRoutes, { prefix: API_PREFIX });

  return app;
}

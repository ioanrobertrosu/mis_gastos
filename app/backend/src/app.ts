import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { PrismaClient } from './generated/prisma/client.js';
import { apiRoutes } from './modules/index.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { prismaPlugin } from './plugins/prisma.js';

export const API_PREFIX = '/api/v1';

export interface BuildAppOptions extends FastifyServerOptions {
  prisma: PrismaClient;
  /** Por defecto `false`: los errores 500 no revelan su mensaje original. */
  exposeInternalErrors?: boolean;
}

export async function buildApp({
  prisma,
  exposeInternalErrors = false,
  ...options
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify(options);

  await app.register(errorHandlerPlugin, { exposeInternalErrors });
  await app.register(prismaPlugin, { client: prisma });

  // /health queda fuera del prefijo: lo consume el healthcheck de Docker.
  await app.register(healthRoutes);
  await app.register(apiRoutes, { prefix: API_PREFIX });

  return app;
}

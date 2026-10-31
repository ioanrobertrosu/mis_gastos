import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { PrismaClient } from './generated/prisma/client.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { prismaPlugin } from './plugins/prisma.js';

export interface BuildAppOptions extends FastifyServerOptions {
  prisma: PrismaClient;
}

export async function buildApp({ prisma, ...options }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify(options);

  await app.register(prismaPlugin, { client: prisma });
  await app.register(healthRoutes);

  return app;
}

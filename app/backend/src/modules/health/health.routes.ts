import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // Sin límite: el healthcheck de Docker no debe poder agotarlo ni quedar bloqueado por él.
  app.get('/health', { config: { rateLimit: false } }, async (request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up' };
    } catch (error) {
      request.log.warn({ err: error }, 'Health check: la base de datos no responde');
      reply.code(503);
      return { status: 'error', db: 'down' };
    }
  });
};

import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (request, reply) => {
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

import fp from 'fastify-plugin';
import type { PrismaClient } from '../generated/prisma/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export interface PrismaPluginOptions {
  client: PrismaClient;
}

export const prismaPlugin = fp<PrismaPluginOptions>(
  async (app, { client }) => {
    app.decorate('prisma', client);

    app.addHook('onClose', async (instance) => {
      await instance.prisma.$disconnect();
    });
  },
  { name: 'prisma' },
);

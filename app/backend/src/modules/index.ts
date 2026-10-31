import type { FastifyPluginAsync } from 'fastify';
import { meRoutes } from './users/me.routes.js';

/** Rutas de negocio, montadas bajo API_PREFIX. Cada módulo registra aquí su plugin. */
export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(meRoutes);
};

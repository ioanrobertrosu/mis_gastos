import type { FastifyPluginAsync } from 'fastify';
import { budgetRoutes } from './budgets/budgets.routes.js';
import { categoryRoutes } from './categories/categories.routes.js';
import { invitationRoutes } from './invitations/invitations.routes.js';
import { memberRoutes } from './members/members.routes.js';
import { meRoutes } from './users/me.routes.js';

/** Rutas de negocio, montadas bajo API_PREFIX. Cada módulo registra aquí su plugin. */
export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(meRoutes);
  await app.register(budgetRoutes);
  await app.register(invitationRoutes);
  await app.register(memberRoutes);
  await app.register(categoryRoutes);
};

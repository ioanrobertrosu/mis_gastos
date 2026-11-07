import type { FastifyPluginAsync } from 'fastify';
import { activityRoutes } from './activity/activity.routes.js';
import { budgetRoutes } from './budgets/budgets.routes.js';
import { categoryRoutes } from './categories/categories.routes.js';
import { goalRoutes } from './goals/goals.routes.js';
import { invitationRoutes } from './invitations/invitations.routes.js';
import { memberRoutes } from './members/members.routes.js';
import { realtimeRoutes } from './realtime/realtime.routes.js';
import { transactionRoutes } from './transactions/transactions.routes.js';
import { meRoutes } from './users/me.routes.js';

/** Rutas de negocio, montadas bajo API_PREFIX. Cada módulo registra aquí su plugin. */
export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(meRoutes);
  await app.register(budgetRoutes);
  await app.register(invitationRoutes);
  await app.register(memberRoutes);
  await app.register(categoryRoutes);
  await app.register(transactionRoutes);
  await app.register(goalRoutes);
  await app.register(activityRoutes);
  await app.register(realtimeRoutes);
};

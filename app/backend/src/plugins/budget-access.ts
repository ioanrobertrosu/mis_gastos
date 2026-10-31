import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Role } from '../generated/prisma/enums.js';
import { budgetNotFound } from '../modules/budgets/errors.js';
import { type Action, can } from '../modules/budgets/permissions.js';
import { ForbiddenError } from '../shared/errors.js';

export interface BudgetMembership {
  budgetId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * `preHandler` para rutas con parámetro `:id` de presupuesto: 404 si el usuario no es
     * miembro, 403 si su rol no permite `action`. Rellena `request.membership`.
     * Requiere `authenticate` antes (onRequest).
     */
    requirePermission: (action: Action) => (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    membership: BudgetMembership;
  }
}

export const budgetAccessPlugin = fp(
  async (app) => {
    app.decorateRequest('membership', null as unknown as BudgetMembership);

    app.decorate('requirePermission', (action: Action) => async (request: FastifyRequest) => {
      const { id: budgetId } = request.params as { id: string };
      const membership = await app.prisma.budgetMember.findUnique({
        where: { userId_budgetId: { userId: request.user.sub, budgetId } },
        select: { role: true },
      });

      if (!membership) throw budgetNotFound();
      if (!can(membership.role, action)) {
        throw new ForbiddenError('Tu rol en este presupuesto no permite esta acción');
      }
      request.membership = { budgetId, role: membership.role };
    });
  },
  { name: 'budget-access', dependencies: ['prisma', 'auth'] },
);

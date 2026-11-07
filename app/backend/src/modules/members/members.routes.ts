import { type FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox';
import { Role } from '../../generated/prisma/enums.js';
import { IdParamsSchema } from '../../shared/schemas.js';
import { BudgetSchema } from '../budgets/budgets.routes.js';
import {
  changeMemberRole,
  leaveBudget,
  listMembers,
  removeMember,
  transferOwnership,
} from './members.service.js';

const MemberSchema = Type.Object({
  userId: Type.String(),
  email: Type.String(),
  displayName: Type.Union([Type.String(), Type.Null()]),
  avatarUrl: Type.Union([Type.String(), Type.Null()]),
  role: Type.Enum(Role),
  joinedAt: Type.String({ format: 'date-time' }),
});

const ChangeRoleBodySchema = Type.Object(
  {
    // Asignar OWNER es una transferencia de propiedad, que tiene su propio flujo.
    role: Type.Union([
      Type.Literal(Role.EDITOR),
      Type.Literal(Role.LIMITED_EDITOR),
      Type.Literal(Role.VIEWER),
    ]),
  },
  { additionalProperties: false },
);

const TransferOwnershipBodySchema = Type.Object(
  { userId: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
);

const MemberParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  userId: Type.String({ format: 'uuid' }),
});

export const memberRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // preParsing: tras el límite de peticiones y antes de leer el body (sin token, solo un 401).
  app.addHook('preParsing', app.authenticate);

  app.get(
    '/budgets/:id/members',
    {
      schema: { params: IdParamsSchema, response: { 200: Type.Array(MemberSchema) } },
      preHandler: app.requirePermission('budget:read'),
    },
    (request) => listMembers(app.prisma, request.params.id),
  );

  app.patch(
    '/budgets/:id/members/:userId',
    {
      schema: {
        params: MemberParamsSchema,
        body: ChangeRoleBodySchema,
        response: { 200: MemberSchema },
      },
      preHandler: app.requirePermission('member:manage'),
    },
    async (request) => {
      const { id: budgetId, userId } = request.params;
      const member = await changeMemberRole(
        app.prisma,
        budgetId,
        request.user.sub,
        userId,
        request.body.role,
      );
      app.realtime.publish({ type: 'updated', budgetId, entity: 'member', id: userId });
      return member;
    },
  );

  app.delete(
    '/budgets/:id/members/:userId',
    {
      schema: { params: MemberParamsSchema },
      preHandler: app.requirePermission('member:manage'),
    },
    async (request, reply) => {
      const { id: budgetId, userId } = request.params;
      await removeMember(app.prisma, budgetId, request.user.sub, userId);
      app.realtime.removeMember(budgetId, userId, 'REMOVED');
      app.realtime.publish({ type: 'deleted', budgetId, entity: 'member', id: userId });
      return reply.code(204).send();
    },
  );

  app.delete(
    '/budgets/:id/membership',
    { schema: { params: IdParamsSchema }, preHandler: app.requirePermission('budget:read') },
    async (request, reply) => {
      const budgetId = request.params.id;
      await leaveBudget(app.prisma, budgetId, request.user.sub);
      app.realtime.removeMember(budgetId, request.user.sub, 'LEFT');
      app.realtime.publish({ type: 'deleted', budgetId, entity: 'member', id: request.user.sub });
      return reply.code(204).send();
    },
  );

  app.post(
    '/budgets/:id/ownership',
    {
      schema: {
        params: IdParamsSchema,
        body: TransferOwnershipBodySchema,
        response: { 200: BudgetSchema },
      },
      preHandler: app.requirePermission('member:manage'),
    },
    async (request) => {
      const { id: budgetId } = request.params;
      const { userId } = request.body;
      const budget = await transferOwnership(app.prisma, budgetId, request.user.sub, userId);
      app.realtime.publish({ type: 'updated', budgetId, entity: 'member', id: userId });
      return budget;
    },
  );
};

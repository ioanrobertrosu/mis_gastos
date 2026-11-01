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
  // onRequest: autenticar antes de validar el body (sin token, 401 y no detalles del esquema).
  app.addHook('onRequest', app.authenticate);

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
    (request) =>
      changeMemberRole(
        app.prisma,
        request.params.id,
        request.user.sub,
        request.params.userId,
        request.body.role,
      ),
  );

  app.delete(
    '/budgets/:id/members/:userId',
    {
      schema: { params: MemberParamsSchema },
      preHandler: app.requirePermission('member:manage'),
    },
    async (request, reply) => {
      await removeMember(app.prisma, request.params.id, request.user.sub, request.params.userId);
      return reply.code(204).send();
    },
  );

  app.delete(
    '/budgets/:id/membership',
    { schema: { params: IdParamsSchema }, preHandler: app.requirePermission('budget:read') },
    async (request, reply) => {
      await leaveBudget(app.prisma, request.params.id, request.user.sub);
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
    (request) =>
      transferOwnership(app.prisma, request.params.id, request.user.sub, request.body.userId),
  );
};

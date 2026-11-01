import { type FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox';
import { Role } from '../../generated/prisma/enums.js';
import { IdParamsSchema } from '../../shared/schemas.js';
import { BudgetSchema } from '../budgets/budgets.routes.js';
import { acceptInvitation, createInvitation, revokeInvitation } from './invitations.service.js';

const InvitationSchema = Type.Object({
  id: Type.String(),
  token: Type.String(),
  role: Type.Enum(Role),
  expiresAt: Type.String({ format: 'date-time' }),
  createdAt: Type.String({ format: 'date-time' }),
});

const CreateInvitationBodySchema = Type.Object(
  {
    // La propiedad solo se transfiere manualmente: no se puede invitar como OWNER.
    role: Type.Optional(
      Type.Union([
        Type.Literal(Role.EDITOR),
        Type.Literal(Role.LIMITED_EDITOR),
        Type.Literal(Role.VIEWER),
      ]),
    ),
    expiresInHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 168 })),
  },
  { additionalProperties: false },
);

const InvitationParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  inviteId: Type.String({ format: 'uuid' }),
});

const TokenParamsSchema = Type.Object({ token: Type.String({ format: 'uuid' }) });

export const invitationRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // onRequest: autenticar antes de validar el body (sin token, 401 y no detalles del esquema).
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/budgets/:id/invitations',
    {
      schema: {
        params: IdParamsSchema,
        body: CreateInvitationBodySchema,
        response: { 201: InvitationSchema },
      },
      preHandler: app.requirePermission('invite:manage'),
    },
    async (request, reply) => {
      reply.code(201);
      return createInvitation(app.prisma, {
        ...request.body,
        budgetId: request.params.id,
        createdById: request.user.sub,
      });
    },
  );

  app.post(
    '/invitations/:token/accept',
    {
      schema: { params: TokenParamsSchema, response: { 201: BudgetSchema } },
      // Ruta expuesta a tokens adivinados: se limita por IP.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      reply.code(201);
      return acceptInvitation(app.prisma, request.user.sub, request.params.token);
    },
  );

  app.delete(
    '/budgets/:id/invitations/:inviteId',
    {
      schema: { params: InvitationParamsSchema },
      preHandler: app.requirePermission('invite:manage'),
    },
    async (request, reply) => {
      await revokeInvitation(app.prisma, request.params.id, request.params.inviteId);
      return reply.code(204).send();
    },
  );
};

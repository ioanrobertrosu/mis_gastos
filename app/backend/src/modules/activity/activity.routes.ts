import { type FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox';
import { ActivityAction } from '../../generated/prisma/enums.js';
import { IdParamsSchema } from '../../shared/schemas.js';
import { listActivity } from './activity.service.js';

const ActivityItemSchema = Type.Object({
  id: Type.String(),
  action: Type.Enum(ActivityAction),
  metadata: Type.Unknown(),
  createdAt: Type.String({ format: 'date-time' }),
  actor: Type.Union([
    Type.Object({
      id: Type.String(),
      displayName: Type.Union([Type.String(), Type.Null()]),
      avatarUrl: Type.Union([Type.String(), Type.Null()]),
    }),
    Type.Null(),
  ]),
});

const ActivityPageSchema = Type.Object({
  items: Type.Array(ActivityItemSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});

const ActivityQuerySchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const activityRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // onRequest: autenticar antes de validar (sin token, 401 y no detalles del esquema).
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/budgets/:id/activity',
    {
      schema: {
        params: IdParamsSchema,
        querystring: ActivityQuerySchema,
        response: { 200: ActivityPageSchema },
      },
      preHandler: app.requirePermission('budget:read'),
    },
    (request) => listActivity(app.prisma, request.params.id, request.query),
  );
};

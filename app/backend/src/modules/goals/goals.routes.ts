import { type FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox';
import { GoalStatus } from '../../generated/prisma/enums.js';
import { DateSchema } from '../../shared/date.js';
import { PositiveMoneySchema } from '../../shared/money.js';
import { IdParamsSchema } from '../../shared/schemas.js';
import { addContribution, listContributions } from './contributions.service.js';
import { createGoal, deleteGoal, getGoal, listGoals, updateGoal } from './goals.service.js';

export const GoalSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  targetAmount: Type.String(),
  currentAmount: Type.String(),
  deadline: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  status: Type.Enum(GoalStatus),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const GoalTitleSchema = Type.String({ minLength: 1, maxLength: 60, pattern: String.raw`\S` });

const CreateGoalBodySchema = Type.Object(
  {
    title: GoalTitleSchema,
    targetAmount: PositiveMoneySchema,
    deadline: Type.Optional(DateSchema),
  },
  { additionalProperties: false },
);

// `status` y `currentAmount` no se editan: se derivan de las contribuciones.
const UpdateGoalBodySchema = Type.Object(
  {
    title: Type.Optional(GoalTitleSchema),
    targetAmount: Type.Optional(PositiveMoneySchema),
    deadline: Type.Optional(Type.Union([DateSchema, Type.Null()])),
    archived: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false, minProperties: 1 },
);

const ListGoalsQuerySchema = Type.Object(
  { status: Type.Optional(Type.Enum(GoalStatus)) },
  { additionalProperties: false },
);

const ContributionSchema = Type.Object({
  id: Type.String(),
  amount: Type.String(),
  userId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});

const ContributionListItemSchema = Type.Object({
  id: Type.String(),
  amount: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  author: Type.Union([
    Type.Object({
      id: Type.String(),
      displayName: Type.Union([Type.String(), Type.Null()]),
      avatarUrl: Type.Union([Type.String(), Type.Null()]),
    }),
    Type.Null(),
  ]),
});

const ContributionBodySchema = Type.Object(
  { amount: PositiveMoneySchema },
  { additionalProperties: false },
);

export const GoalParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  goalId: Type.String({ format: 'uuid' }),
});

export const goalRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // onRequest: autenticar antes de validar el body (sin token, 401 y no detalles del esquema).
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/budgets/:id/goals',
    {
      schema: {
        params: IdParamsSchema,
        querystring: ListGoalsQuerySchema,
        response: { 200: Type.Array(GoalSchema) },
      },
      preHandler: app.requirePermission('budget:read'),
    },
    (request) => listGoals(app.prisma, request.params.id, request.query.status),
  );

  app.get(
    '/budgets/:id/goals/:goalId',
    {
      schema: { params: GoalParamsSchema, response: { 200: GoalSchema } },
      preHandler: app.requirePermission('budget:read'),
    },
    (request) => getGoal(app.prisma, request.params.id, request.params.goalId),
  );

  app.post(
    '/budgets/:id/goals',
    {
      schema: { params: IdParamsSchema, body: CreateGoalBodySchema, response: { 201: GoalSchema } },
      preHandler: app.requirePermission('goal:manage'),
    },
    async (request, reply) => {
      const budgetId = request.params.id;
      const goal = await createGoal(app.prisma, budgetId, request.user.sub, request.body);
      app.realtime.publish({ type: 'created', budgetId, entity: 'goal', id: goal.id });
      reply.code(201);
      return goal;
    },
  );

  app.patch(
    '/budgets/:id/goals/:goalId',
    {
      schema: {
        params: GoalParamsSchema,
        body: UpdateGoalBodySchema,
        response: { 200: GoalSchema },
      },
      preHandler: app.requirePermission('goal:manage'),
    },
    async (request) => {
      const { id: budgetId, goalId } = request.params;
      const goal = await updateGoal(app.prisma, budgetId, goalId, request.user.sub, request.body);
      app.realtime.publish({ type: 'updated', budgetId, entity: 'goal', id: goalId });
      return goal;
    },
  );

  app.get(
    '/budgets/:id/goals/:goalId/contributions',
    {
      schema: {
        params: GoalParamsSchema,
        response: { 200: Type.Array(ContributionListItemSchema) },
      },
      preHandler: app.requirePermission('budget:read'),
    },
    (request) => listContributions(app.prisma, request.params.id, request.params.goalId),
  );

  app.post(
    '/budgets/:id/goals/:goalId/contributions',
    {
      schema: {
        params: GoalParamsSchema,
        body: ContributionBodySchema,
        response: { 201: Type.Object({ contribution: ContributionSchema, goal: GoalSchema }) },
      },
      preHandler: app.requirePermission('goal:contribute'),
    },
    async (request, reply) => {
      const { id: budgetId, goalId } = request.params;
      const result = await addContribution(
        app.prisma,
        budgetId,
        goalId,
        request.user.sub,
        request.body.amount,
      );
      // La aportación cambia la meta; el cliente refresca la meta y sus contribuciones a la vez.
      app.realtime.publish({ type: 'updated', budgetId, entity: 'goal', id: goalId });
      reply.code(201);
      return result;
    },
  );

  app.delete(
    '/budgets/:id/goals/:goalId',
    { schema: { params: GoalParamsSchema }, preHandler: app.requirePermission('goal:manage') },
    async (request, reply) => {
      const { id: budgetId, goalId } = request.params;
      await deleteGoal(app.prisma, budgetId, goalId, request.user.sub);
      app.realtime.publish({ type: 'deleted', budgetId, entity: 'goal', id: goalId });
      return reply.code(204).send();
    },
  );
};

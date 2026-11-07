import { type FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox';
import { Currency, Role } from '../../generated/prisma/enums.js';
import { MonthSchema } from '../../shared/month.js';
import { IdParamsSchema } from '../../shared/schemas.js';
import {
  createBudget,
  deleteBudget,
  getBudget,
  listBudgets,
  updateBudget,
} from './budgets.service.js';
import { getBudgetSummary } from './summary.service.js';

export const BudgetSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  currency: Type.Enum(Currency),
  role: Type.Enum(Role),
  memberCount: Type.Integer(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const BudgetNameSchema = Type.String({ minLength: 1, maxLength: 60, pattern: String.raw`\S` });

const CreateBudgetBodySchema = Type.Object(
  { name: BudgetNameSchema, currency: Type.Optional(Type.Enum(Currency)) },
  { additionalProperties: false },
);

const UpdateBudgetBodySchema = Type.Object(
  { name: Type.Optional(BudgetNameSchema), currency: Type.Optional(Type.Enum(Currency)) },
  { additionalProperties: false, minProperties: 1 },
);

const SummarySchema = Type.Object({
  month: Type.String(),
  currency: Type.Enum(Currency),
  allocated: Type.String(),
  spent: Type.String(),
  remaining: Type.String(),
  percentUsed: Type.Union([Type.Number(), Type.Null()]),
});

const SummaryQuerySchema = Type.Object(
  { month: Type.Optional(MonthSchema) },
  { additionalProperties: false },
);

export const budgetRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // onRequest: autenticar antes de validar el body (sin token, 401 y no detalles del esquema).
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/budgets',
    { schema: { body: CreateBudgetBodySchema, response: { 201: BudgetSchema } } },
    async (request, reply) => {
      reply.code(201);
      return createBudget(app.prisma, request.user.sub, request.body);
    },
  );

  app.get('/budgets', { schema: { response: { 200: Type.Array(BudgetSchema) } } }, (request) =>
    listBudgets(app.prisma, request.user.sub),
  );

  app.get(
    '/budgets/:id',
    { schema: { params: IdParamsSchema, response: { 200: BudgetSchema } } },
    (request) => getBudget(app.prisma, request.user.sub, request.params.id),
  );

  app.patch(
    '/budgets/:id',
    {
      schema: {
        params: IdParamsSchema,
        body: UpdateBudgetBodySchema,
        response: { 200: BudgetSchema },
      },
      preHandler: app.requirePermission('budget:update'),
    },
    async (request) => {
      const budgetId = request.params.id;
      const budget = await updateBudget(app.prisma, request.user.sub, budgetId, request.body);
      app.realtime.publish({ type: 'updated', budgetId, entity: 'budget', id: budgetId });
      return budget;
    },
  );

  app.get(
    '/budgets/:id/summary',
    {
      schema: {
        params: IdParamsSchema,
        querystring: SummaryQuerySchema,
        response: { 200: SummarySchema },
      },
      preHandler: app.requirePermission('budget:read'),
    },
    (request) => getBudgetSummary(app.prisma, request.params.id, request.query.month),
  );

  app.delete(
    '/budgets/:id',
    { schema: { params: IdParamsSchema }, preHandler: app.requirePermission('budget:delete') },
    async (request, reply) => {
      const budgetId = request.params.id;
      await deleteBudget(app.prisma, budgetId);
      app.realtime.publish({ type: 'deleted', budgetId, entity: 'budget', id: budgetId });
      return reply.code(204).send();
    },
  );
};

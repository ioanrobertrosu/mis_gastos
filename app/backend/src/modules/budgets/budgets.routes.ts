import { type FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox';
import { Currency, Role } from '../../generated/prisma/enums.js';
import { IdParamsSchema } from '../../shared/schemas.js';
import { createBudget, getBudget, listBudgets } from './budgets.service.js';

const BudgetSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  currency: Type.Enum(Currency),
  role: Type.Enum(Role),
  memberCount: Type.Integer(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const CreateBudgetBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 60, pattern: String.raw`\S` }),
    currency: Type.Optional(Type.Enum(Currency)),
  },
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
};

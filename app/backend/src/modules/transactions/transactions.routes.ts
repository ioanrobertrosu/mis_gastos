import { type FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox';
import { PositiveMoneySchema } from '../../shared/money.js';
import { IdParamsSchema } from '../../shared/schemas.js';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
} from './transactions.service.js';

const TransactionSchema = Type.Object({
  id: Type.String(),
  categoryId: Type.String(),
  amount: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  date: Type.String({ format: 'date' }),
  isRecurring: Type.Boolean(),
  createdById: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const DescriptionSchema = Type.String({ minLength: 1, maxLength: 200, pattern: String.raw`\S` });
// Día natural, sin hora: el cliente envía la fecha local del gasto.
const DateSchema = Type.String({ format: 'date' });

const CreateTransactionBodySchema = Type.Object(
  {
    categoryId: Type.String({ format: 'uuid' }),
    amount: PositiveMoneySchema,
    date: DateSchema,
    description: Type.Optional(DescriptionSchema),
    isRecurring: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const UpdateTransactionBodySchema = Type.Object(
  {
    categoryId: Type.Optional(Type.String({ format: 'uuid' })),
    amount: Type.Optional(PositiveMoneySchema),
    date: Type.Optional(DateSchema),
    description: Type.Optional(Type.Union([DescriptionSchema, Type.Null()])),
    isRecurring: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false, minProperties: 1 },
);

const TransactionPageSchema = Type.Object({
  items: Type.Array(TransactionSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});

const ListTransactionsQuerySchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(Type.String({ minLength: 1 })),
    categoryId: Type.Optional(Type.String({ format: 'uuid' })),
    from: Type.Optional(DateSchema),
    to: Type.Optional(DateSchema),
    isRecurring: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const TransactionParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  transactionId: Type.String({ format: 'uuid' }),
});

export const transactionRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // onRequest: autenticar antes de validar el body (sin token, 401 y no detalles del esquema).
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/budgets/:id/transactions',
    {
      schema: {
        params: IdParamsSchema,
        body: CreateTransactionBodySchema,
        response: { 201: TransactionSchema },
      },
      preHandler: app.requirePermission('transaction:create'),
    },
    async (request, reply) => {
      reply.code(201);
      return createTransaction(app.prisma, request.params.id, request.user.sub, request.body);
    },
  );

  app.get(
    '/budgets/:id/transactions',
    {
      schema: {
        params: IdParamsSchema,
        querystring: ListTransactionsQuerySchema,
        response: { 200: TransactionPageSchema },
      },
      preHandler: app.requirePermission('budget:read'),
    },
    (request) => listTransactions(app.prisma, request.params.id, request.query),
  );

  app.get(
    '/budgets/:id/transactions/:transactionId',
    {
      schema: { params: TransactionParamsSchema, response: { 200: TransactionSchema } },
      preHandler: app.requirePermission('budget:read'),
    },
    (request) => getTransaction(app.prisma, request.params.id, request.params.transactionId),
  );

  app.patch(
    '/budgets/:id/transactions/:transactionId',
    {
      schema: {
        params: TransactionParamsSchema,
        body: UpdateTransactionBodySchema,
        response: { 200: TransactionSchema },
      },
      preHandler: app.requirePermission('transaction:edit-own'),
    },
    (request) =>
      updateTransaction(
        app.prisma,
        request.params.id,
        request.params.transactionId,
        { userId: request.user.sub, role: request.membership.role },
        request.body,
      ),
  );

  app.delete(
    '/budgets/:id/transactions/:transactionId',
    {
      schema: { params: TransactionParamsSchema },
      preHandler: app.requirePermission('transaction:edit-own'),
    },
    async (request, reply) => {
      await deleteTransaction(app.prisma, request.params.id, request.params.transactionId, {
        userId: request.user.sub,
        role: request.membership.role,
      });
      return reply.code(204).send();
    },
  );
};

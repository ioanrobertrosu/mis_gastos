import { Readable } from 'node:stream';
import { type FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox';
import { DateSchema } from '../../shared/date.js';
import { ValidationError } from '../../shared/errors.js';
import { PositiveMoneySchema } from '../../shared/money.js';
import { IdParamsSchema } from '../../shared/schemas.js';
import { exportTransactionsCsv } from './export.service.js';
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

const ExportQuerySchema = Type.Object(
  { from: DateSchema, to: DateSchema },
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
      const budgetId = request.params.id;
      const transaction = await createTransaction(
        app.prisma,
        budgetId,
        request.user.sub,
        request.body,
      );
      app.realtime.publish({
        type: 'created',
        budgetId,
        entity: 'transaction',
        id: transaction.id,
      });
      reply.code(201);
      return transaction;
    },
  );

  app.get(
    '/budgets/:id/export',
    {
      schema: { params: IdParamsSchema, querystring: ExportQuerySchema },
      preHandler: app.requirePermission('budget:export'),
    },
    (request, reply) => {
      const { from, to } = request.query;
      if (from > to) {
        throw new ValidationError('La fecha inicial no puede ser posterior a la final');
      }
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="gastos_${from}_${to}.csv"`)
        .send(Readable.from(exportTransactionsCsv(app.prisma, request.params.id, { from, to })));
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
    async (request) => {
      const { id: budgetId, transactionId } = request.params;
      const transaction = await updateTransaction(
        app.prisma,
        budgetId,
        transactionId,
        { userId: request.user.sub, role: request.membership.role },
        request.body,
      );
      app.realtime.publish({ type: 'updated', budgetId, entity: 'transaction', id: transactionId });
      return transaction;
    },
  );

  app.delete(
    '/budgets/:id/transactions/:transactionId',
    {
      schema: { params: TransactionParamsSchema },
      preHandler: app.requirePermission('transaction:edit-own'),
    },
    async (request, reply) => {
      const { id: budgetId, transactionId } = request.params;
      await deleteTransaction(app.prisma, budgetId, transactionId, {
        userId: request.user.sub,
        role: request.membership.role,
      });
      app.realtime.publish({ type: 'deleted', budgetId, entity: 'transaction', id: transactionId });
      return reply.code(204).send();
    },
  );
};

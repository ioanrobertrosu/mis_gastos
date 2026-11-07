import { type FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox';
import { MoneySchema } from '../../shared/money.js';
import { MonthSchema } from '../../shared/month.js';
import { IdParamsSchema } from '../../shared/schemas.js';
import {
  createCategory,
  deactivateCategory,
  listCategories,
  updateCategory,
} from './categories.service.js';

const CategorySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  monthlyLimit: Type.String(),
  icon: Type.String(),
  colorHex: Type.String(),
  isActive: Type.Boolean(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const CategoryNameSchema = Type.String({ minLength: 1, maxLength: 40, pattern: String.raw`\S` });
// Nombre de icono del cliente (p. ej. `shopping-cart`).
const IconSchema = Type.String({
  minLength: 1,
  maxLength: 40,
  pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
});
const ColorHexSchema = Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' });

const CreateCategoryBodySchema = Type.Object(
  {
    name: CategoryNameSchema,
    monthlyLimit: MoneySchema,
    icon: Type.Optional(IconSchema),
    colorHex: Type.Optional(ColorHexSchema),
  },
  { additionalProperties: false },
);

const UpdateCategoryBodySchema = Type.Object(
  {
    name: Type.Optional(CategoryNameSchema),
    monthlyLimit: Type.Optional(MoneySchema),
    icon: Type.Optional(IconSchema),
    colorHex: Type.Optional(ColorHexSchema),
    // Solo para reactivar; desactivar es DELETE.
    isActive: Type.Optional(Type.Literal(true)),
  },
  { additionalProperties: false, minProperties: 1 },
);

const CategoryWithSpendingSchema = Type.Object({
  ...CategorySchema.properties,
  spent: Type.String(),
  percentUsed: Type.Union([Type.Number(), Type.Null()]),
});

const ListCategoriesQuerySchema = Type.Object(
  { includeInactive: Type.Optional(Type.Boolean()), month: Type.Optional(MonthSchema) },
  { additionalProperties: false },
);

const CategoryParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  categoryId: Type.String({ format: 'uuid' }),
});

export const categoryRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // preParsing: tras el límite de peticiones y antes de leer el body (sin token, solo un 401).
  app.addHook('preParsing', app.authenticate);

  app.get(
    '/budgets/:id/categories',
    {
      schema: {
        params: IdParamsSchema,
        querystring: ListCategoriesQuerySchema,
        response: { 200: Type.Array(CategoryWithSpendingSchema) },
      },
      preHandler: app.requirePermission('budget:read'),
    },
    (request) => listCategories(app.prisma, request.params.id, request.query),
  );

  app.post(
    '/budgets/:id/categories',
    {
      schema: {
        params: IdParamsSchema,
        body: CreateCategoryBodySchema,
        response: { 201: CategorySchema },
      },
      preHandler: app.requirePermission('category:manage'),
    },
    async (request, reply) => {
      const budgetId = request.params.id;
      const category = await createCategory(app.prisma, budgetId, request.user.sub, request.body);
      app.realtime.publish({ type: 'created', budgetId, entity: 'category', id: category.id });
      reply.code(201);
      return category;
    },
  );

  app.patch(
    '/budgets/:id/categories/:categoryId',
    {
      schema: {
        params: CategoryParamsSchema,
        body: UpdateCategoryBodySchema,
        response: { 200: CategorySchema },
      },
      preHandler: app.requirePermission('category:manage'),
    },
    async (request) => {
      const { id: budgetId, categoryId } = request.params;
      const category = await updateCategory(
        app.prisma,
        budgetId,
        categoryId,
        request.user.sub,
        request.body,
      );
      app.realtime.publish({ type: 'updated', budgetId, entity: 'category', id: categoryId });
      return category;
    },
  );

  app.delete(
    '/budgets/:id/categories/:categoryId',
    {
      schema: { params: CategoryParamsSchema },
      preHandler: app.requirePermission('category:manage'),
    },
    async (request, reply) => {
      const { id: budgetId, categoryId } = request.params;
      await deactivateCategory(app.prisma, budgetId, categoryId, request.user.sub);
      app.realtime.publish({ type: 'deleted', budgetId, entity: 'category', id: categoryId });
      return reply.code(204).send();
    },
  );
};

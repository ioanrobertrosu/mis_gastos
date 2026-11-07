import { type FastifyPluginAsyncTypebox, type Static, Type } from '@fastify/type-provider-typebox';
import type { Prisma } from '../../generated/prisma/client.js';
import { Currency, Role } from '../../generated/prisma/enums.js';
import { deleteAccount } from './account.service.js';

const Nullable = <T extends ReturnType<typeof Type.String>>(schema: T) =>
  Type.Union([schema, Type.Null()]);

const ProfileSchema = Type.Object({
  id: Type.String(),
  email: Type.String(),
  displayName: Nullable(Type.String()),
  avatarUrl: Nullable(Type.String()),
  createdAt: Type.String({ format: 'date-time' }),
  identities: Type.Array(
    Type.Object({ provider: Type.String(), createdAt: Type.String({ format: 'date-time' }) }),
  ),
  // Resumen ligero; el detalle de cada presupuesto está en GET /budgets.
  memberships: Type.Array(
    Type.Object({
      budgetId: Type.String(),
      budgetName: Type.String(),
      currency: Type.Enum(Currency),
      role: Type.Enum(Role),
      joinedAt: Type.String({ format: 'date-time' }),
    }),
  ),
});

const UpdateMeBodySchema = Type.Object(
  {
    displayName: Type.Optional(
      Nullable(Type.String({ minLength: 1, maxLength: 50, pattern: String.raw`\S` })),
    ),
    avatarUrl: Type.Optional(
      Nullable(Type.String({ format: 'uri', pattern: '^https://', maxLength: 2048 })),
    ),
  },
  { additionalProperties: false, minProperties: 1 },
);

const profileSelect = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  createdAt: true,
  identities: { select: { provider: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
  memberships: {
    select: {
      role: true,
      joinedAt: true,
      budget: { select: { id: true, name: true, currency: true } },
    },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.UserSelect;

type Profile = Static<typeof ProfileSchema>;

function toProfile(user: Prisma.UserGetPayload<{ select: typeof profileSelect }>): Profile {
  return {
    ...user,
    createdAt: user.createdAt.toISOString(),
    identities: user.identities.map((identity) => ({
      provider: identity.provider,
      createdAt: identity.createdAt.toISOString(),
    })),
    memberships: user.memberships.map(({ role, joinedAt, budget }) => ({
      budgetId: budget.id,
      budgetName: budget.name,
      currency: budget.currency,
      role,
      joinedAt: joinedAt.toISOString(),
    })),
  };
}

export const meRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // onRequest: autenticar antes de validar el body (sin token, 401 y no detalles del esquema).
  app.addHook('onRequest', app.authenticate);

  app.get('/me', { schema: { response: { 200: ProfileSchema } } }, async (request) => {
    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: request.user.sub },
      select: profileSelect,
    });
    return toProfile(user);
  });

  app.patch(
    '/me',
    { schema: { body: UpdateMeBodySchema, response: { 200: ProfileSchema } } },
    async (request) => {
      const user = await app.prisma.user.update({
        where: { id: request.user.sub },
        data: request.body,
        select: profileSelect,
      });
      return toProfile(user);
    },
  );

  app.delete('/me', async (request, reply) => {
    const userId = request.user.sub;
    const leftBudgets = await deleteAccount(app.prisma, userId);
    for (const budgetId of leftBudgets) {
      app.realtime.publish({ type: 'deleted', budgetId, entity: 'member', id: userId });
    }

    // Tras confirmar el borrado local: si Supabase falla, la cuenta ya está anonimizada y su
    // token recibe 401, así que no se deshace. Se registra para limpiarla manualmente.
    try {
      await app.authAdmin.deleteUser(userId);
    } catch (error) {
      request.log.error({ err: error, userId }, 'No se pudo borrar el usuario en Supabase Auth');
    }
    return reply.code(204).send();
  });
};

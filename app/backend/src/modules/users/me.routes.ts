import { type FastifyPluginAsyncTypebox, type Static, Type } from '@fastify/type-provider-typebox';
import type { Prisma } from '../../generated/prisma/client.js';
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
  // Se rellenará en la Fase 3 con los presupuestos del usuario (BudgetMember).
  memberships: Type.Array(Type.Object({})),
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
    memberships: [],
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
    await deleteAccount(app.prisma, request.user.sub);
    return reply.code(204).send();
  });
};

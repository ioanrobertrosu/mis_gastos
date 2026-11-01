import type { Role } from '../../src/generated/prisma/client.js';
import { testPrisma } from './db.js';
import { signTestToken, TEST_USER } from './jwt.js';

export interface TestUser {
  sub: string;
  email: string;
}

export const ANA: TestUser = { sub: TEST_USER.sub, email: TEST_USER.email };
export const BEA: TestUser = {
  sub: '2c1f0b9e-7d3a-4f6b-9e8d-1a2b3c4d5e6f',
  email: 'bea@example.com',
};
export const CARLOS: TestUser = {
  sub: '7e6d5c4b-3a29-4810-8f7e-6d5c4b3a2918',
  email: 'carlos@example.com',
};
export const DANI: TestUser = {
  sub: '4b3a2918-0f7e-4d5c-8b3a-29180f7e6d5c',
  email: 'dani@example.com',
};
export const EVA: TestUser = {
  sub: '8f7e6d5c-4b3a-4291-80f7-e6d5c4b3a291',
  email: 'eva@example.com',
};

/** Cabecera `Authorization` para el usuario (cada uno con su propio `provider_id`). */
export async function authHeader(user: TestUser): Promise<{ authorization: string }> {
  const token = await signTestToken({
    sub: user.sub,
    email: user.email,
    userMetadata: { provider_id: `google-${user.sub}` },
  });
  return { authorization: `Bearer ${token}` };
}

/** Crea el usuario directamente en la BD de test (sin pasar por la API). */
export async function seedUser(user: TestUser): Promise<void> {
  // Un único INSERT … ON CONFLICT DO NOTHING: `upsert` abre una transacción implícita.
  await testPrisma.user.createMany({
    data: [{ id: user.sub, email: user.email }],
    skipDuplicates: true,
  });
}

/** Crea un presupuesto con sus miembros directamente en la BD de test. */
export async function seedBudget(
  members: { user: TestUser; role: Role }[],
  data: { name?: string } = {},
): Promise<string> {
  for (const { user } of members) await seedUser(user);
  // Un mismo INSERT asigna el mismo joinedAt a todos: se escalonan para fijar el orden de entrada.
  const start = Date.now();
  const budget = await testPrisma.budget.create({
    data: {
      name: data.name ?? 'Presupuesto de prueba',
      members: {
        create: members.map(({ user, role }, i) => ({
          userId: user.sub,
          role,
          joinedAt: new Date(start + i),
        })),
      },
    },
  });
  return budget.id;
}

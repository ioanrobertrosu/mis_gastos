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
  await testPrisma.user.upsert({
    where: { id: user.sub },
    create: { id: user.sub, email: user.email },
    update: {},
  });
}

/** Crea un presupuesto con sus miembros directamente en la BD de test. */
export async function seedBudget(
  members: { user: TestUser; role: Role }[],
  data: { name?: string } = {},
): Promise<string> {
  for (const { user } of members) await seedUser(user);
  const budget = await testPrisma.budget.create({
    data: {
      name: data.name ?? 'Presupuesto de prueba',
      members: { create: members.map(({ user, role }) => ({ userId: user.sub, role })) },
    },
  });
  return budget.id;
}

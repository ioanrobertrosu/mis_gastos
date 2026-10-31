import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { testDatabaseUrls } from './test-env.js';

/** Cliente compartido por los tests de integración, conectado a la BD de test. */
export const testPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testDatabaseUrls().databaseUrl }),
});

/** Vacía todas las tablas del esquema public salvo el historial de migraciones. */
export async function resetDatabase(prisma: PrismaClient = testPrisma): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;

  const list = tables.map(({ tablename }) => `"public"."${tablename.replaceAll('"', '""')}"`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list.join(', ')} RESTART IDENTITY CASCADE`);
}

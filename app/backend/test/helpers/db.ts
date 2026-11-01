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
  try {
    // lock_timeout: si una sesión colgada retiene bloqueos, fallar en vez de esperar sin fin.
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`SET LOCAL lock_timeout = '15s'`),
      prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list.join(', ')} RESTART IDENTITY CASCADE`),
    ]);
  } catch (error) {
    throw new Error(
      'No se pudo vaciar la BD de test (¿una transacción colgada retiene bloqueos? ' +
        "revisa pg_stat_activity: state = 'idle in transaction')",
      { cause: error },
    );
  }
}

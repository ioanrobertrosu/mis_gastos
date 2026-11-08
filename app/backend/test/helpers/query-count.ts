import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { testDatabaseUrls } from './test-env.js';

/**
 * Cliente de la BD de test que cuenta las consultas SQL que envía (sin BEGIN/COMMIT). En
 * producción cada consulta es un viaje de ida y vuelta a Supabase (~30 ms): su número importa
 * más que su plan.
 */
export class QueryCounter {
  readonly prisma: PrismaClient;
  readonly queries: string[] = [];

  constructor() {
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrls().databaseUrl }),
      log: [{ emit: 'event', level: 'query' }],
    });
    client.$on('query', ({ query }) => {
      if (!/^(BEGIN|COMMIT|ROLLBACK)\b/.test(query)) this.queries.push(query);
    });
    this.prisma = client;
  }

  get count(): number {
    return this.queries.length;
  }

  reset(): void {
    this.queries.length = 0;
  }
}

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildApp } from './app.js';
import { PrismaClient } from './generated/prisma/client.js';

// La validación estricta de variables de entorno llegará con src/config/env.ts (TODO 1.4).
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const isDev = process.env.NODE_ENV !== 'production';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const app = await buildApp({
  prisma,
  logger: isDev ? { transport: { target: 'pino-pretty' } } : true,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'Cerrando servidor');
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

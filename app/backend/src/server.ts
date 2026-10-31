import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { buildLoggerOptions } from './config/logger.js';
import { PrismaClient } from './generated/prisma/client.js';

const env = loadEnv();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

const app = await buildApp({
  prisma,
  exposeInternalErrors: env.NODE_ENV !== 'production',
  corsOrigins: env.CORS_ORIGINS,
  logger: buildLoggerOptions(env.NODE_ENV),
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'Cerrando servidor');
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

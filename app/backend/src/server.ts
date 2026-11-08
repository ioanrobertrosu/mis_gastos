import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { createRemoteJWKSet } from 'jose';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { buildLoggerOptions } from './config/logger.js';
import { PrismaClient } from './generated/prisma/client.js';
import { createSupabaseAuthAdmin } from './modules/users/auth-admin.js';

const env = loadEnv();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

const app = await buildApp({
  prisma,
  auth: {
    jwtSecret: env.SUPABASE_JWT_SECRET,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    // Claves públicas de Supabase; `jose` las cachea y vuelve a pedirlas ante una `kid` nueva.
    jwks: createRemoteJWKSet(new URL(`${env.JWT_ISSUER}/.well-known/jwks.json`)),
  },
  authAdmin: createSupabaseAuthAdmin({
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  }),
  exposeInternalErrors: env.NODE_ENV !== 'production',
  corsOrigins: env.CORS_ORIGINS,
  trustedProxies: env.TRUST_PROXY,
  docs: env.NODE_ENV !== 'production',
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

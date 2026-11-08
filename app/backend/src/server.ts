import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { createRemoteJWKSet } from 'jose';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { buildLoggerOptions } from './config/logger.js';
import { readFile } from 'node:fs/promises';
import * as Sentry from '@sentry/node';
import { createErrorReporter } from './config/error-reporter.js';
import { PrismaClient } from './generated/prisma/client.js';
import { createSupabaseAuthAdmin } from './modules/users/auth-admin.js';

const env = loadEnv();

const { version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };
// Sin SENTRY_DSN no hace nada. Se inicializa antes de crear la app para capturar también los
// errores fuera de las peticiones (promesas rechazadas sin capturar, excepciones al arrancar).
const errorReporter = createErrorReporter(
  {
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE ?? `mis-gastos-api@${version}`,
  },
  Sentry,
);

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
  errorReporter,
  logger: buildLoggerOptions(env.NODE_ENV),
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'Cerrando servidor');
    // Sentry.close envía los eventos pendientes (sin DSN no hay nada que enviar).
    void app
      .close()
      .then(() => Sentry.close(2000))
      .then(() => process.exit(0));
  });
}

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  Sentry.captureException(error);
  await Sentry.close(2000);
  process.exit(1);
}

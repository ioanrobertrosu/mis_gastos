import 'dotenv/config';
import { buildApp } from './app.js';

// La validación estricta de variables de entorno llegará con src/config/env.ts (TODO 1.4).
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const isDev = process.env.NODE_ENV !== 'production';

const app = await buildApp({
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

import type { FastifyServerOptions } from 'fastify';
import type { Env } from './env.js';

type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

// Nunca deben llegar a los logs: el JWT de Supabase y las cookies de sesión.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  '*.headers.authorization',
  '*.headers.cookie',
];

export function buildLoggerOptions(nodeEnv: Env['NODE_ENV']): LoggerOptions {
  const redact = { paths: REDACT_PATHS, censor: '[REDACTED]' };

  switch (nodeEnv) {
    case 'production':
      return { level: 'info', redact };
    case 'development':
      return { level: 'debug', redact, transport: { target: 'pino-pretty' } };
    case 'test':
      return { level: 'silent', redact };
  }
}

import { FormatRegistry, type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

// `Value.Check` no trae formatos predefinidos (los de Fastify vienen de ajv-formats).
FormatRegistry.Set('http-url', (value) => {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === 'https:' || protocol === 'http:';
});

const EnvSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
    { default: 'development' },
  ),
  HOST: Type.String({ minLength: 1, default: '0.0.0.0' }),
  PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3000 }),
  DATABASE_URL: Type.String({ minLength: 1 }),
  CORS_ORIGINS: Type.String({ default: '' }),
  SUPABASE_JWT_SECRET: Type.String({ minLength: 32 }),
  JWT_ISSUER: Type.String({ format: 'http-url' }),
  JWT_AUDIENCE: Type.String({ minLength: 1, default: 'authenticated' }),
  // API de administración de Auth (borrado de cuentas). La clave omite todas las políticas RLS.
  SUPABASE_URL: Type.String({ format: 'http-url' }),
  SUPABASE_SERVICE_ROLE_KEY: Type.String({ minLength: 1 }),
  // Número de proxies delante del backend. Mal ajustado: pocos, todos los clientes comparten
  // el límite de peticiones; demasiados, un cliente puede falsificar su IP.
  // Como texto: la conversión de TypeBox aceptaría `true` como 1 y confiaría en un proxy sin querer.
  TRUST_PROXY: Type.String({ pattern: '^[0-9]+$', default: '0' }),
});

export type Env = Omit<Static<typeof EnvSchema>, 'CORS_ORIGINS' | 'TRUST_PROXY'> & {
  CORS_ORIGINS: string[];
  TRUST_PROXY: number;
};

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export class EnvValidationError extends Error {
  override name = 'EnvValidationError';
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = Value.Convert(
    EnvSchema,
    Value.Default(EnvSchema, Value.Clean(EnvSchema, { ...source })),
  );

  if (Value.Check(EnvSchema, env)) {
    return {
      ...env,
      CORS_ORIGINS: parseList(env.CORS_ORIGINS),
      TRUST_PROXY: Number(env.TRUST_PROXY),
    };
  }

  // Una sola línea por variable aunque el esquema genere varios errores (p. ej. uniones).
  const problems = new Map<string, string>();
  for (const error of Value.Errors(EnvSchema, env)) {
    const variable = error.path.slice(1);
    if (!problems.has(variable)) problems.set(variable, error.message);
  }

  const details = [...problems].map(([variable, message]) => `  - ${variable}: ${message}`);
  throw new EnvValidationError(`Variables de entorno inválidas:\n${details.join('\n')}`);
}

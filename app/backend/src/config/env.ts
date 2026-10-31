import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const EnvSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
    { default: 'development' },
  ),
  HOST: Type.String({ minLength: 1, default: '0.0.0.0' }),
  PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3000 }),
  DATABASE_URL: Type.String({ minLength: 1 }),
});

export type Env = Static<typeof EnvSchema>;

export class EnvValidationError extends Error {
  override name = 'EnvValidationError';
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = Value.Convert(
    EnvSchema,
    Value.Default(EnvSchema, Value.Clean(EnvSchema, { ...source })),
  );

  if (Value.Check(EnvSchema, env)) {
    return env;
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

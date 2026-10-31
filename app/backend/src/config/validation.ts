import AjvCompiler from '@fastify/ajv-compiler';
import type { FastifyServerOptions } from 'fastify';

const buildCoercing = AjvCompiler();
const buildStrict = AjvCompiler();

/**
 * Dos validadores sobre el compilador de Fastify:
 * - `params`/`querystring`/`headers` convierten tipos (todo llega como texto en la URL).
 * - `body` no convierte nada: en JSON, `""` no es `null` ni `42` es `"42"`.
 * En ambos, los campos no declarados se rechazan en vez de eliminarse en silencio.
 */
const buildValidator: AjvCompiler.BuildCompilerFromPool = (externalSchemas) => {
  const coercing = buildCoercing(externalSchemas, { customOptions: { removeAdditional: false } });
  const strict = buildStrict(externalSchemas, {
    customOptions: { removeAdditional: false, coerceTypes: false },
  });
  type Compile = typeof coercing;
  // Fastify invoca el compilador con la definición de ruta ({ schema, httpPart, … }),
  // aunque los tipos de @fastify/ajv-compiler lo declaren como un esquema.
  return ((route: { httpPart?: string }) =>
    (route.httpPart === 'body' ? strict : coercing)(route as Parameters<Compile>[0])) as Compile;
};

export const schemaController: NonNullable<FastifyServerOptions['schemaController']> = {
  compilersFactory: { buildValidator },
};

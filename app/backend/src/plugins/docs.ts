import { readFile } from 'node:fs/promises';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';

export interface DocsOptions {
  /** Prefijo de las rutas que exigen el JWT de Supabase. */
  apiPrefix: string;
}

/**
 * Documentación OpenAPI generada a partir de los esquemas TypeBox de cada ruta: UI en `/docs`
 * y documento en `/docs/json`. Solo en desarrollo. Debe registrarse antes que las rutas.
 */
export const docsPlugin = fp<DocsOptions>(
  async (app, { apiPrefix }) => {
    const { version } = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    await app.register(swagger, {
      openapi: {
        info: { title: 'Mis Gastos API', version },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
      // Todas las rutas de la API pasan por `authenticate`; /health y /docs son públicas.
      transform: ({ schema, url }) => ({
        schema: url.startsWith(`${apiPrefix}/`)
          ? { ...schema, security: [{ bearerAuth: [] }] }
          : schema,
        url,
      }),
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  },
  { name: 'docs' },
);

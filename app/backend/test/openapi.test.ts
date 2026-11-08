import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { fakePrisma } from './helpers/fake-prisma.js';
import { TEST_AUTH } from './helpers/jwt.js';

interface OpenApiOperation {
  security?: Record<string, string[]>[];
  requestBody?: { content: Record<string, { schema: { properties?: Record<string, unknown> } }> };
  responses: Record<string, { content?: Record<string, { schema: Record<string, unknown> }> }>;
}

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { securitySchemes: Record<string, unknown> };
}

describe('documentación OpenAPI', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function spec(): Promise<OpenApiDocument> {
    app = await buildApp({ auth: TEST_AUTH, prisma: fakePrisma(), docs: true });
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it('por defecto (producción) no se publica: ni la UI ni el documento', async () => {
    app = await buildApp({ auth: TEST_AUTH, prisma: fakePrisma() });

    const ui = await app.inject({ method: 'GET', url: '/docs' });
    const json = await app.inject({ method: 'GET', url: '/docs/json' });

    expect(ui.statusCode).toBe(404);
    expect(json.statusCode).toBe(404);
  });

  it('con docs, sirve la UI sin necesidad de token', async () => {
    app = await buildApp({ auth: TEST_AUTH, prisma: fakePrisma(), docs: true });

    const response = await app.inject({ method: 'GET', url: '/docs/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
  });

  it('el documento es OpenAPI 3 con el título y la versión de la API', async () => {
    const document = await spec();

    expect(document.openapi).toMatch(/^3\./);
    expect(document.info).toEqual({ title: 'Mis Gastos API', version: expect.any(String) });
  });

  it('incluye las rutas de la API con sus parámetros de ruta en formato OpenAPI', async () => {
    const { paths } = await spec();

    expect(Object.keys(paths)).toEqual(
      expect.arrayContaining([
        '/health',
        '/api/v1/me',
        '/api/v1/budgets',
        '/api/v1/budgets/{id}/transactions',
        '/api/v1/budgets/{id}/transactions/{transactionId}',
        '/api/v1/budgets/{id}/goals/{goalId}/contributions',
        '/api/v1/budgets/{id}/activity',
        '/api/v1/invitations/{token}/accept',
      ]),
    );
    expect(Object.keys(paths['/api/v1/budgets/{id}/transactions']!).sort()).toEqual([
      'get',
      'post',
    ]);
  });

  it('documenta los cuerpos y las respuestas a partir de los esquemas de validación', async () => {
    const { paths } = await spec();

    const create = paths['/api/v1/budgets/{id}/transactions']!.post!;
    expect(create.requestBody!.content['application/json']!.schema.properties).toHaveProperty(
      'amount',
    );
    const contributions = paths['/api/v1/budgets/{id}/goals/{goalId}/contributions']!.get!;
    expect(contributions.responses['200']!.content!['application/json']!.schema.properties).toEqual(
      expect.objectContaining({ items: expect.anything(), nextCursor: expect.anything() }),
    );
  });

  it('declara la autenticación Bearer (JWT) en las rutas de la API, no en /health', async () => {
    const { paths, components } = await spec();

    expect(components.securitySchemes).toEqual({
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    });
    expect(paths['/api/v1/me']!.get!.security).toEqual([{ bearerAuth: [] }]);
    expect(paths['/api/v1/budgets/{id}/transactions']!.post!.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(paths['/health']!.get!.security).toBeUndefined();
  });

  it('no documenta sus propias rutas de documentación', async () => {
    const { paths } = await spec();

    expect(Object.keys(paths).filter((path) => path.startsWith('/docs'))).toEqual([]);
  });
});

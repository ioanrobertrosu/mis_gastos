import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { IdParamsSchema } from '../../src/shared/schemas.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import { ANA, authHeader, BEA, seedBudget } from '../helpers/users.js';

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
  for (const action of ['budget:update', 'transaction:create'] as const) {
    app.get(
      `/prueba/${action}/:id`,
      {
        schema: { params: IdParamsSchema },
        onRequest: app.authenticate,
        preHandler: app.requirePermission(action),
      },
      async (request) => request.membership,
    );
  }
});

async function get(action: string, id: string) {
  return app.inject({
    method: 'GET',
    url: `/prueba/${action}/${id}`,
    headers: await authHeader(ANA),
  });
}

describe('requirePermission', () => {
  it('deja pasar a un rol con permiso y expone request.membership', async () => {
    const id = await seedBudget([{ user: ANA, role: 'OWNER' }]);

    const response = await get('budget:update', id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ budgetId: id, role: 'OWNER' });
  });

  it('rechaza con 403 a un miembro sin permiso para la acción', async () => {
    const id = await seedBudget([
      { user: BEA, role: 'OWNER' },
      { user: ANA, role: 'EDITOR' },
    ]);

    const response = await get('budget:update', id);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('aplica la matriz de la acción concreta (LIMITED_EDITOR puede crear transacciones)', async () => {
    const id = await seedBudget([
      { user: BEA, role: 'OWNER' },
      { user: ANA, role: 'LIMITED_EDITOR' },
    ]);

    const response = await get('transaction:create', id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ budgetId: id, role: 'LIMITED_EDITOR' });
  });

  it('a un no miembro le da el mismo 404 que GET /budgets/:id', async () => {
    const id = await seedBudget([{ user: BEA, role: 'OWNER' }]);

    const response = await get('budget:update', id);
    const budget404 = await app.inject({
      method: 'GET',
      url: `/api/v1/budgets/${id}`,
      headers: await authHeader(ANA),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(budget404.json());
  });
});

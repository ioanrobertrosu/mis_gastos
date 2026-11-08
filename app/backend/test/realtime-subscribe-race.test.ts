import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { fakePrisma } from './helpers/fake-prisma.js';
import { TEST_AUTH } from './helpers/jwt.js';
import { ANA, authHeader } from './helpers/users.js';
import { TestClients } from './helpers/ws.js';
import type { FastifyInstance } from 'fastify';

const BUDGET_ID = '11111111-1111-4111-8111-111111111111';

let app: FastifyInstance | undefined;
let clients: TestClients | undefined;

afterEach(async () => {
  clients?.closeAll();
  await app?.close();
});

describe('suscripción simultánea a la pérdida de la membresía', () => {
  it('si se pierde la membresía justo al unirse a la sala, no queda suscrito', async () => {
    const prisma = fakePrisma();
    // La identidad ya existe; la membresía es válida en la primera comprobación pero ya no en
    // la segunda: la expulsión se ha confirmado entre ambas y su limpieza de la sala ya pasó.
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ deletedAt: null } as never);
    vi.mocked(prisma.budgetMember.findUnique)
      .mockResolvedValueOnce({ id: 'membresia' } as never)
      .mockResolvedValueOnce(null);
    app = await buildApp({ auth: TEST_AUTH, prisma });
    await app.listen({ port: 0, host: '127.0.0.1' });
    clients = new TestClients(app);
    const client = await clients.connect(await authHeader(ANA));

    client.send({ type: 'subscribe', budgetId: BUDGET_ID });

    await expect(client.next()).resolves.toEqual({
      type: 'error',
      code: 'NOT_FOUND',
      budgetId: BUDGET_ID,
    });
    app.realtime.publish({ type: 'updated', budgetId: BUDGET_ID, entity: 'budget', id: BUDGET_ID });
    await client.expectSilence();
  });
});

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { fakePrisma } from './helpers/fake-prisma.js';
import { TEST_AUTH } from './helpers/jwt.js';
import { ANA, authHeader, BEA } from './helpers/users.js';
import { TestClients } from './helpers/ws.js';

const INTERVAL_MS = 100;
const BUDGET_ID = '11111111-1111-4111-8111-111111111111';

let app: FastifyInstance;
let clients: TestClients;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(async () => {
  const prisma = fakePrisma();
  vi.mocked(prisma.user.findFirst).mockResolvedValue({ deletedAt: null } as never);
  vi.mocked(prisma.budgetMember.findUnique).mockResolvedValue({ id: 'membresia' } as never);
  app = await buildApp({ auth: TEST_AUTH, prisma, heartbeatIntervalMs: INTERVAL_MS });
  await app.listen({ port: 0, host: '127.0.0.1' });
  clients = new TestClients(app);
});

afterEach(async () => {
  clients.closeAll();
  await app.close();
});

describe('heartbeat de WebSocket', () => {
  it('hace ping periódicamente y mantiene abierta una conexión que responde', async () => {
    const client = await clients.connect(await authHeader(ANA));
    let pings = 0;
    client.socket.on('ping', () => (pings += 1));

    await wait(INTERVAL_MS * 5);

    expect(pings).toBeGreaterThanOrEqual(3);
    expect(client.isOpen).toBe(true);
    expect(app.realtime.connectionCount).toBe(1);
  });

  it('termina la conexión que no responde y la olvida', async () => {
    const dead = await clients.connect(await authHeader(ANA), '/ws', [], { autoPong: false });
    expect(app.realtime.connectionCount).toBe(1);

    // 1006: cierre abrupto, sin saludo de cierre, porque el otro extremo ya no responde.
    await expect(dead.closeCode(INTERVAL_MS * 10)).resolves.toBe(1006);

    await vi.waitFor(() => expect(app.realtime.connectionCount).toBe(0));
  });

  it('solo termina las que no responden: una viva sigue recibiendo eventos', async () => {
    const dead = await clients.connect(await authHeader(ANA), '/ws', [], { autoPong: false });
    const alive = await clients.connect(await authHeader(BEA));
    alive.send({ type: 'subscribe', budgetId: BUDGET_ID });
    dead.send({ type: 'subscribe', budgetId: BUDGET_ID });
    await expect(alive.next()).resolves.toMatchObject({ type: 'subscribed' });

    await dead.closeCode(INTERVAL_MS * 10);
    app.realtime.publish({ type: 'updated', budgetId: BUDGET_ID, entity: 'budget', id: BUDGET_ID });

    expect(alive.isOpen).toBe(true);
    await expect(alive.next()).resolves.toMatchObject({ type: 'updated', entity: 'budget' });
  });

  it('cerrar la app detiene el heartbeat y cierra las conexiones sin colgarse', async () => {
    const client = await clients.connect(await authHeader(ANA));

    await app.close();

    await expect(client.closeCode(2_000)).resolves.toBeTypeOf('number');
  });
});

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testPrisma } from '../helpers/db.js';
import { signTestToken, TEST_AUTH } from '../helpers/jwt.js';
import { ANA, authHeader, BEA, CARLOS, seedBudget, seedUser } from '../helpers/users.js';
import { HandshakeRejected, TestClients } from '../helpers/ws.js';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let app: FastifyInstance;
let clients: TestClients;

// Una sola app en escucha por fichero: cada test abre y cierra sus propias conexiones.
beforeAll(async () => {
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
  await app.listen({ port: 0, host: '127.0.0.1' });
  clients = new TestClients(app);
});

afterEach(() => {
  clients.closeAll();
});

afterAll(async () => {
  await app.close();
});

async function rejectedStatus(attempt: Promise<unknown>): Promise<number> {
  const error = await attempt.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(HandshakeRejected);
  return (error as HandshakeRejected).statusCode;
}

describe('WS /api/v1/ws — autenticación del handshake', () => {
  it('sin token se rechaza con 401', async () => {
    await expect(rejectedStatus(clients.connect())).resolves.toBe(401);
  });

  it('con un token inválido se rechaza con 401', async () => {
    const token = await signTestToken({ secret: 'otro-secreto-de-al-menos-32-caracteres!!' });

    await expect(
      rejectedStatus(clients.connect({ authorization: `Bearer ${token}` })),
    ).resolves.toBe(401);
  });

  it('con un token caducado se rechaza con 401', async () => {
    const token = await signTestToken({ expiresAt: Math.floor(Date.now() / 1000) - 60 });

    await expect(
      rejectedStatus(clients.connect({ authorization: `Bearer ${token}` })),
    ).resolves.toBe(401);
  });

  it('un token en la URL no vale: acabaría en los logs', async () => {
    const token = await signTestToken();

    await expect(rejectedStatus(clients.connect({}, `/ws?access_token=${token}`))).resolves.toBe(
      401,
    );
  });

  it('una cuenta borrada se rechaza con 401', async () => {
    await seedUser(ANA);
    await testPrisma.user.update({ where: { id: ANA.sub }, data: { deletedAt: new Date() } });

    await expect(rejectedStatus(clients.connect(await authHeader(ANA)))).resolves.toBe(401);
  });

  it('con un token válido la conexión se abre', async () => {
    const client = await clients.connect(await authHeader(ANA));

    expect(client.isOpen).toBe(true);
  });

  it('la conexión se cierra con 4401 cuando caduca el token', async () => {
    const token = await signTestToken({ expiresAt: Math.floor(Date.now() / 1000) + 2 });

    const client = await clients.connect({ authorization: `Bearer ${token}` });

    expect(client.isOpen).toBe(true);
    await expect(client.closeCode(5_000)).resolves.toBe(4401);
  });
});

describe('WS /api/v1/ws — token en Sec-WebSocket-Protocol (navegadores)', () => {
  function connectWithProtocols(protocols: string[]) {
    return clients.connect({}, '/ws', protocols);
  }

  it('acepta ["bearer", token] y negocia solo "bearer", sin devolver el token', async () => {
    const token = await signTestToken();

    const client = await connectWithProtocols(['bearer', token]);

    expect(client.isOpen).toBe(true);
    expect(client.socket.protocol).toBe('bearer');
  });

  it('funciona igual que por cabecera: identifica al usuario y permite suscribirse', async () => {
    const budgetId = await seedBudget([{ user: ANA, role: 'OWNER' }]);
    const client = await connectWithProtocols(['bearer', await signTestToken()]);

    client.send({ type: 'subscribe', budgetId });

    await expect(client.next()).resolves.toEqual({ type: 'subscribed', budgetId });
  });

  it('también se cierra con 4401 cuando caduca el token', async () => {
    const token = await signTestToken({ expiresAt: Math.floor(Date.now() / 1000) + 2 });

    const client = await connectWithProtocols(['bearer', token]);

    await expect(client.closeCode(5_000)).resolves.toBe(4401);
  });

  it.each([
    ['token inválido', async () => ['bearer', 'no-es-un-jwt']],
    [
      'token firmado con otro secreto',
      async () => [
        'bearer',
        await signTestToken({ secret: 'otro-secreto-de-al-menos-32-caracteres!!' }),
      ],
    ],
    ['"bearer" sin token', async () => ['bearer']],
    ['token sin "bearer"', async () => [await signTestToken()]],
    ['token antes de "bearer"', async () => [await signTestToken(), 'bearer']],
    ['otro protocolo', async () => ['chat', await signTestToken()]],
  ])('se rechaza con 401: %s', async (_case, protocols) => {
    await expect(rejectedStatus(connectWithProtocols(await protocols()))).resolves.toBe(401);
  });

  it('si llegan ambos, manda la cabecera Authorization', async () => {
    const budgetId = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const anaToken = await signTestToken();

    const client = await clients.connect(await authHeader(BEA), '/ws', ['bearer', anaToken]);
    client.send({ type: 'subscribe', budgetId });

    await expect(client.next()).resolves.toEqual({ type: 'subscribed', budgetId });
  });

  it('una cabecera inválida no se suple con el protocolo', async () => {
    await expect(
      rejectedStatus(
        clients.connect({ authorization: 'Bearer no-es-un-jwt' }, '/ws', [
          'bearer',
          await signTestToken(),
        ]),
      ),
    ).resolves.toBe(401);
  });

  it('el protocolo no autentica en las rutas REST', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { 'sec-websocket-protocol': `bearer, ${await signTestToken()}` },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('WS /api/v1/ws — suscripciones', () => {
  it('un miembro se suscribe a su presupuesto; también un VIEWER', async () => {
    const budgetId = await seedBudget([
      { user: ANA, role: 'OWNER' },
      { user: CARLOS, role: 'VIEWER' },
    ]);
    const owner = await clients.connect(await authHeader(ANA));
    const viewer = await clients.connect(await authHeader(CARLOS));

    owner.send({ type: 'subscribe', budgetId });
    viewer.send({ type: 'subscribe', budgetId });

    await expect(owner.next()).resolves.toEqual({ type: 'subscribed', budgetId });
    await expect(viewer.next()).resolves.toEqual({ type: 'subscribed', budgetId });
  });

  it('un no miembro recibe NOT_FOUND, igual que con un presupuesto inexistente', async () => {
    const foreign = await seedBudget([{ user: BEA, role: 'OWNER' }]);
    const client = await clients.connect(await authHeader(ANA));

    client.send({ type: 'subscribe', budgetId: foreign });
    client.send({ type: 'subscribe', budgetId: MISSING_ID });

    await expect(client.next()).resolves.toEqual({
      type: 'error',
      code: 'NOT_FOUND',
      budgetId: foreign,
    });
    await expect(client.next()).resolves.toEqual({
      type: 'error',
      code: 'NOT_FOUND',
      budgetId: MISSING_ID,
    });
    expect(client.isOpen).toBe(true);
  });

  it('se puede cancelar una suscripción', async () => {
    const budgetId = await seedBudget([{ user: ANA, role: 'OWNER' }]);
    const client = await clients.connect(await authHeader(ANA));
    client.send({ type: 'subscribe', budgetId });
    await client.next();

    client.send({ type: 'unsubscribe', budgetId });

    await expect(client.next()).resolves.toEqual({ type: 'unsubscribed', budgetId });
  });

  it.each([
    ['texto que no es JSON', 'hola'],
    ['JSON que no es un objeto', '[1,2]'],
    ['tipo desconocido', { type: 'publish', budgetId: MISSING_ID }],
    ['sin budgetId', { type: 'subscribe' }],
    ['budgetId que no es UUID', { type: 'subscribe', budgetId: 'abc' }],
    ['campo no permitido', { type: 'subscribe', budgetId: MISSING_ID, role: 'OWNER' }],
  ])('un mensaje inválido devuelve INVALID_MESSAGE sin cerrar: %s', async (_case, message) => {
    const client = await clients.connect(await authHeader(ANA));

    client.send(message);

    await expect(client.next()).resolves.toEqual({ type: 'error', code: 'INVALID_MESSAGE' });
    expect(client.isOpen).toBe(true);
  });

  it('un mensaje por encima del límite cierra la conexión con 1009', async () => {
    const client = await clients.connect(await authHeader(ANA));

    client.send('x'.repeat(4097));

    await expect(client.closeCode()).resolves.toBe(1009);
  });

  it('un mensaje de exactamente el tamaño límite se procesa', async () => {
    const client = await clients.connect(await authHeader(ANA));

    client.send('x'.repeat(4096));

    await expect(client.next()).resolves.toEqual({ type: 'error', code: 'INVALID_MESSAGE' });
    expect(client.isOpen).toBe(true);
  });
});

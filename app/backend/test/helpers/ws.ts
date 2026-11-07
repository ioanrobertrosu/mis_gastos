import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';

export interface ServerMessage {
  type: string;
  budgetId?: string;
  code?: string;
  [key: string]: unknown;
}

/** Cliente WebSocket de test: guarda los mensajes y permite esperarlos en orden. */
export class TestClient {
  private readonly received: ServerMessage[] = [];
  private waiter: ((message: ServerMessage) => void) | undefined;
  private readonly closed: Promise<number>;

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      if (this.waiter) {
        this.waiter(message);
        this.waiter = undefined;
      } else {
        this.received.push(message);
      }
    });
    this.closed = new Promise((resolve) => socket.once('close', (code) => resolve(code)));
  }

  send(message: unknown): void {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  /** Siguiente mensaje recibido; falla si no llega a tiempo. */
  next(timeoutMs = 3_000): Promise<ServerMessage> {
    const queued = this.received.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        reject(new Error(`Sin mensajes tras ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiter = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
    });
  }

  /** Comprueba que no llega nada durante `ms` (para eventos que no deben recibirse). */
  async expectSilence(ms = 300): Promise<void> {
    const message = await this.next(ms).catch(() => undefined);
    if (message) throw new Error(`Mensaje inesperado: ${JSON.stringify(message)}`);
  }

  /** Código con el que se cierra la conexión; falla si sigue abierta tras el plazo. */
  closeCode(timeoutMs = 5_000): Promise<number> {
    return Promise.race([
      this.closed,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error('La conexión sigue abierta')), timeoutMs),
      ),
    ]);
  }

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }
}

/** Abre conexiones contra una app en escucha y las cierra todas al terminar cada test. */
export class TestClients {
  private readonly open = new Set<WebSocket>();

  constructor(private readonly app: FastifyInstance) {}

  private url(path: string): string {
    const address = this.app.server.address();
    if (address === null || typeof address === 'string')
      throw new Error('La app no está en escucha');
    return `ws://127.0.0.1:${address.port}/api/v1${path}`;
  }

  /** Resuelve con el cliente al abrirse; rechaza con el estado HTTP si el handshake se rechaza. */
  connect(
    headers: Record<string, string> = {},
    path = '/ws',
    protocols: string[] = [],
  ): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url(path), protocols, { headers });
      this.open.add(socket);
      const client = new TestClient(socket);
      socket.once('open', () => resolve(client));
      socket.once('unexpected-response', (_request, response) => {
        socket.terminate();
        reject(new HandshakeRejected(response.statusCode ?? 0));
      });
      socket.once('error', (error) => reject(error));
    });
  }

  closeAll(): void {
    for (const socket of this.open) socket.terminate();
    this.open.clear();
  }
}

export class HandshakeRejected extends Error {
  constructor(readonly statusCode: number) {
    super(`Handshake rechazado con ${statusCode}`);
  }
}

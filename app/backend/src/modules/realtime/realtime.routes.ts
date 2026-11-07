import { type Static, Type } from '@fastify/type-provider-typebox';
import { Value } from '@sinclair/typebox/value';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';

const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
/** Los mensajes de suscripción son diminutos: lo que supere esto cierra la conexión (1009). */
export const MAX_CLIENT_MESSAGE_BYTES = 4096;
/** Cierre por token caducado; el cliente debe reconectar con un token nuevo. */
const CLOSE_TOKEN_EXPIRED = 4401;
/** Máximo de `setTimeout`: más allá, dispararía de inmediato. */
const MAX_TIMER_MS = 2 ** 31 - 1;
export const BEARER_PROTOCOL = 'bearer';

const ClientMessageSchema = Type.Object(
  {
    type: Type.Union([Type.Literal('subscribe'), Type.Literal('unsubscribe')]),
    budgetId: Type.String({ pattern: UUID }),
  },
  { additionalProperties: false },
);

type ClientMessage = Static<typeof ClientMessageSchema>;

function parseMessage(data: unknown): ClientMessage | null {
  try {
    const message: unknown = JSON.parse(String(data));
    return Value.Check(ClientMessageSchema, message) ? message : null;
  } catch {
    return null;
  }
}

/**
 * Los navegadores no pueden enviar cabeceras en un WebSocket: mandan el JWT como subprotocolo,
 * `new WebSocket(url, ['bearer', token])`. Se traslada a `Authorization` (que tiene prioridad)
 * para reutilizar `authenticate`. Nunca en la URL, que acabaría en los logs.
 */
async function tokenFromProtocol(request: FastifyRequest): Promise<void> {
  if (request.headers.authorization !== undefined) return;
  const [protocol, token, ...rest] = (request.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((value) => value.trim());
  if (protocol === BEARER_PROTOCOL && token && rest.length === 0) {
    request.headers.authorization = `Bearer ${token}`;
  }
}

export const realtimeRoutes: FastifyPluginAsync = async (app) => {
  async function handleMessage(socket: WebSocket, userId: string, data: unknown): Promise<void> {
    const reply = (message: object) => socket.send(JSON.stringify(message));

    const message = parseMessage(data);
    if (!message) return reply({ type: 'error', code: 'INVALID_MESSAGE' });
    const { type, budgetId } = message;

    if (type === 'unsubscribe') {
      app.realtime.leave(budgetId, socket);
      return reply({ type: 'unsubscribed', budgetId });
    }

    const isMember = async () =>
      (await app.prisma.budgetMember.findUnique({
        where: { userId_budgetId: { userId, budgetId } },
        select: { id: true },
      })) !== null;

    // Mismo error si no existe o si no es miembro: no se revela cuál.
    if (!(await isMember())) return reply({ type: 'error', code: 'NOT_FOUND', budgetId });
    // Cerrada durante la consulta: su evento `close` ya pasó y nadie la sacaría de la sala.
    if (socket.readyState !== socket.OPEN) return;

    // Se comprueba otra vez ya en la sala: una expulsión confirmada entre la consulta y la entrada
    // habría limpiado la sala antes de tiempo. La primera comprobación evita que un no miembro
    // llegue a estar en la sala, aunque sea un instante.
    app.realtime.join(budgetId, socket);
    if (!(await isMember())) {
      app.realtime.leave(budgetId, socket);
      return reply({ type: 'error', code: 'NOT_FOUND', budgetId });
    }
    reply({ type: 'subscribed', budgetId });
  }

  app.get(
    '/ws',
    { websocket: true, onRequest: [tokenFromProtocol, app.authenticate] },
    (socket, request) => {
      app.realtime.connect(request.user.sub, socket);

      const expiry = setTimeout(
        () => socket.close(CLOSE_TOKEN_EXPIRED, 'Token caducado'),
        Math.min(request.tokenExpiresAt - Date.now(), MAX_TIMER_MS),
      );
      expiry.unref();

      // En cola: las respuestas salen en el orden de los mensajes aunque consulten la BD.
      let queue = Promise.resolve();
      socket.on('message', (data: unknown) => {
        queue = queue
          .then(() => handleMessage(socket, request.user.sub, data))
          .catch((error: unknown) => {
            request.log.error({ err: error }, 'Error al procesar un mensaje WebSocket');
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({ type: 'error', code: 'INTERNAL_ERROR' }));
            }
          });
      });

      // `ws` emite `error` (p. ej. mensaje demasiado grande) antes de cerrar con su código.
      socket.on('error', (error) => request.log.debug({ err: error }, 'Error de WebSocket'));
      socket.on('close', () => {
        clearTimeout(expiry);
        app.realtime.disconnect(request.user.sub, socket);
      });
    },
  );
};

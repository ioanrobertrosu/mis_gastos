import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { genReqId, REQUEST_ID_HEADER } from './config/request-id.js';
import { schemaController } from './config/validation.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { apiRoutes } from './modules/index.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { RealtimeHub } from './modules/realtime/hub.js';
import { BEARER_PROTOCOL, MAX_CLIENT_MESSAGE_BYTES } from './modules/realtime/realtime.routes.js';
import { type AuthAdmin, NOOP_AUTH_ADMIN } from './modules/users/auth-admin.js';
import { authPlugin, type AuthOptions } from './plugins/auth.js';
import { budgetAccessPlugin } from './plugins/budget-access.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { prismaPlugin } from './plugins/prisma.js';
import { securityPlugin } from './plugins/security.js';

export const API_PREFIX = '/api/v1';

export interface BuildAppOptions extends FastifyServerOptions {
  prisma: PrismaClient;
  /** Verificación de los JWT de Supabase. Obligatoria: no hay app sin autenticación. */
  auth: AuthOptions;
  /** Por defecto `false`: los errores 500 no revelan su mensaje original. */
  exposeInternalErrors?: boolean;
  /** Orígenes permitidos por CORS. Por defecto ninguno. */
  corsOrigins?: string[];
  /** Administración de Supabase Auth (borrado de cuentas). Por defecto no hace nada (tests). */
  authAdmin?: AuthAdmin;
  /** Cada cuánto se comprueba que las conexiones WebSocket siguen vivas. Por defecto 30 s. */
  heartbeatIntervalMs?: number;
}

export async function buildApp({
  prisma,
  auth,
  exposeInternalErrors = false,
  corsOrigins = [],
  authAdmin = NOOP_AUTH_ADMIN,
  heartbeatIntervalMs = 30_000,
  ...options
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ ...options, schemaController, genReqId });
  // En la raíz: cubre también los errores y las rutas inexistentes.
  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
  app.decorate('authAdmin', authAdmin);

  await app.register(errorHandlerPlugin, { exposeInternalErrors });
  await app.register(securityPlugin, { corsOrigins });
  await app.register(prismaPlugin, { client: prisma });
  // Antes de cualquier ruta: un `preHandler: app.authenticate` indefinido dejaría la ruta pública.
  await app.register(authPlugin, auth);
  await app.register(budgetAccessPlugin);
  app.decorate('realtime', new RealtimeHub());
  const heartbeat = setInterval(() => app.realtime.heartbeat(), heartbeatIntervalMs);
  heartbeat.unref();
  app.addHook('onClose', async () => clearInterval(heartbeat));
  await app.register(websocket, {
    options: {
      maxPayload: MAX_CLIENT_MESSAGE_BYTES,
      // Nunca se devuelve el subprotocolo con el token, solo `bearer`.
      handleProtocols: (protocols) => (protocols.has(BEARER_PROTOCOL) ? BEARER_PROTOCOL : false),
    },
  });

  // /health queda fuera del prefijo: lo consume el healthcheck de Docker.
  await app.register(healthRoutes);
  await app.register(apiRoutes, { prefix: API_PREFIX });

  return app;
}

import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Lo que usan los proxies habituales, y nada que permita falsificar líneas de log.
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Reutiliza el id que envía el proxy para correlacionar entre sistemas, si es válido. */
export function genReqId(request: IncomingMessage): string {
  const incoming = request.headers[REQUEST_ID_HEADER];
  return typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

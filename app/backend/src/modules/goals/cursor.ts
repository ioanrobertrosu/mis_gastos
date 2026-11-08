import { ValidationError } from '../../shared/errors.js';

/** Posición en el orden `createdAt DESC, id DESC`: la clave de la última contribución. */
export interface ContributionCursor {
  createdAt: Date;
  id: string;
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaco para el cliente: base64url de `[createdAt ISO, id]` (precisión de milisegundos, la de la BD). */
export function encodeContributionCursor({ createdAt, id }: ContributionCursor): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url');
}

export function decodeContributionCursor(cursor: string): ContributionCursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 2) {
      const [createdAt, id] = value as unknown[];
      if (
        typeof createdAt === 'string' &&
        ISO_DATE_TIME.test(createdAt) &&
        !Number.isNaN(Date.parse(createdAt)) &&
        typeof id === 'string' &&
        UUID.test(id)
      ) {
        return { createdAt: new Date(createdAt), id };
      }
    }
  } catch {
    // Cae al error de abajo.
  }
  throw new ValidationError('El cursor de paginación no es válido');
}

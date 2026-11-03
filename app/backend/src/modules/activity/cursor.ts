import { ValidationError } from '../../shared/errors.js';

/** Opaco para el cliente: base64url de `[seq]` de la última entrada de la página. */
export function encodeActivityCursor(seq: number): string {
  return Buffer.from(JSON.stringify([seq])).toString('base64url');
}

export function decodeActivityCursor(cursor: string): number {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 1 &&
      Number.isSafeInteger(value[0]) &&
      value[0] > 0
    ) {
      return value[0] as number;
    }
  } catch {
    // Cae al error de abajo.
  }
  throw new ValidationError('El cursor de paginación no es válido');
}

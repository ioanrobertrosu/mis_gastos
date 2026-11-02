import { ValidationError } from '../../shared/errors.js';

/** Posición en el orden `date DESC, id DESC`: la clave de la última transacción de la página. */
export interface TransactionCursor {
  /** `YYYY-MM-DD`. */
  date: string;
  id: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaco para el cliente: base64url de `[date, id]`. */
export function encodeCursor({ date, id }: TransactionCursor): string {
  return Buffer.from(JSON.stringify([date, id])).toString('base64url');
}

export function decodeCursor(cursor: string): TransactionCursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 2) {
      const [date, id] = value as unknown[];
      if (typeof date === 'string' && DATE.test(date) && typeof id === 'string' && UUID.test(id)) {
        return { date, id };
      }
    }
  } catch {
    // Cae al error de abajo.
  }
  throw new ValidationError('El cursor de paginación no es válido');
}

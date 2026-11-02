import { Type } from '@fastify/type-provider-typebox';

/** Mes natural `YYYY-MM`. */
export const MonthSchema = Type.String({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$' });

/**
 * Rango de un mes para columnas `@db.Date` (medianoche UTC): `start` incluido, `end` (día 1 del
 * mes siguiente) excluido. Sin mes, el actual en UTC; el cliente puede enviar su mes local.
 */
export function monthRange(month?: string): { start: Date; end: Date } {
  const now = new Date();
  const [year, monthIndex] = month
    ? [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1]
    : [now.getUTCFullYear(), now.getUTCMonth()];
  return {
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

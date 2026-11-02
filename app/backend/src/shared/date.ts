import { Type } from '@fastify/type-provider-typebox';

/** Día natural `YYYY-MM-DD`, sin hora: el cliente envía su fecha local. */
export const DateSchema = Type.String({ format: 'date' });

/** Las columnas `@db.Date` se leen y escriben como medianoche UTC. */
export function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

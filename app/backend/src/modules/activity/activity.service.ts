import type { ActivityAction, Prisma } from '../../generated/prisma/client.js';

type Scalar = string | number | boolean | null;

export interface ActivityEntry {
  budgetId: string;
  /** Quién realiza la acción. */
  userId: string;
  action: ActivityAction;
  metadata: Record<string, Prisma.InputJsonValue | null>;
}

/**
 * Registra una entrada del muro de actividad. Recibe el cliente de la transacción de la
 * mutación: si el registro falla, la mutación se deshace con él (y viceversa).
 */
export async function logActivity(
  tx: Prisma.TransactionClient,
  entry: ActivityEntry,
): Promise<void> {
  await tx.activityLog.create({ data: entry as Prisma.ActivityLogUncheckedCreateInput });
}

export type Changes = Record<string, { from: Scalar; to: Scalar }>;

/**
 * Campos de `after` cuyo valor difiere de `before`, como `{ campo: { from, to } }`. Los valores
 * deben llegar ya normalizados (importes y fechas como texto) para compararlos tal cual.
 */
export function changesBetween<T extends object>(
  before: T,
  after: { [K in keyof T]?: Scalar },
): Changes {
  const changes: Changes = {};
  for (const [field, to] of Object.entries(after) as [keyof T & string, Scalar | undefined][]) {
    const from = (before[field] as Scalar | undefined) ?? null;
    if (to !== undefined && to !== from) {
      changes[field] = { from, to };
    }
  }
  return changes;
}

export function hasChanges(changes: Changes): boolean {
  return Object.keys(changes).length > 0;
}

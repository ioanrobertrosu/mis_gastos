import type { ActivityAction, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { decodeActivityCursor, encodeActivityCursor } from './cursor.js';

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

export const DEFAULT_ACTIVITY_PAGE_SIZE = 20;

export interface ActivityItem {
  id: string;
  action: ActivityAction;
  metadata: Prisma.JsonValue;
  createdAt: string;
  /** Perfil público del autor (ya anonimizado si borró su cuenta); `null` si no hay autor. */
  actor: { id: string; displayName: string | null; avatarUrl: string | null } | null;
}

/**
 * Muro de actividad, más reciente primero. Paginación keyset por `seq`: la página siguiente
 * empieza estrictamente antes del cursor, así que la actividad nueva no la desplaza.
 */
export async function listActivity(
  prisma: PrismaClient,
  budgetId: string,
  { limit = DEFAULT_ACTIVITY_PAGE_SIZE, cursor }: { limit?: number; cursor?: string },
): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  const before = cursor === undefined ? undefined : decodeActivityCursor(cursor);
  const rows = await prisma.activityLog.findMany({
    where: { budgetId, ...(before === undefined ? {} : { seq: { lt: before } }) },
    orderBy: { seq: 'desc' },
    take: limit + 1,
    select: {
      id: true,
      seq: true,
      action: true,
      metadata: true,
      createdAt: true,
      user: { select: { id: true, displayName: true, avatarUrl: true } },
    },
  });

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ id, action, metadata, createdAt, user }) => ({
      id,
      action,
      metadata,
      createdAt: createdAt.toISOString(),
      actor: user,
    })),
    nextCursor: rows.length > limit && last ? encodeActivityCursor(last.seq) : null,
  };
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

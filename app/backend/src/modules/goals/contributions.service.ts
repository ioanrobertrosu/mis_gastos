import type { PrismaClient } from '../../generated/prisma/client.js';
import { ConflictError } from '../../shared/errors.js';
import { formatMoney } from '../../shared/money.js';
import { LOCKING_TRANSACTION } from '../../shared/transactions.js';
import { logActivity } from '../activity/activity.service.js';
import { decodeContributionCursor, encodeContributionCursor } from './cursor.js';
import { getGoal, type GoalView, goalNotFound, logIfReached, statusFor } from './goals.service.js';

export interface ContributionView {
  id: string;
  amount: string;
  userId: string | null;
  createdAt: string;
}

export interface ContributionListItem {
  id: string;
  amount: string;
  createdAt: string;
  /** `null` si el usuario se eliminó físicamente; un usuario borrado (soft delete) ya llega
   * anonimizado ("Usuario Eliminado", sin avatar). */
  author: { id: string; displayName: string | null; avatarUrl: string | null } | null;
}

export const DEFAULT_CONTRIBUTION_PAGE_SIZE = 20;

/**
 * Contribuciones de la meta, más recientes primero. Paginación keyset por `(createdAt, id)`:
 * las aportaciones nuevas entran por delante y no desplazan las páginas siguientes.
 */
export async function listContributions(
  prisma: PrismaClient,
  budgetId: string,
  goalId: string,
  { limit = DEFAULT_CONTRIBUTION_PAGE_SIZE, cursor }: { limit?: number; cursor?: string } = {},
): Promise<{ items: ContributionListItem[]; nextCursor: string | null }> {
  const before = cursor === undefined ? undefined : decodeContributionCursor(cursor);
  const goal = await prisma.goal.findFirst({
    where: { id: goalId, budgetId },
    select: { id: true },
  });
  if (!goal) throw goalNotFound();

  const rows = await prisma.goalContribution.findMany({
    where: {
      goalId,
      ...(before === undefined
        ? {}
        : {
            createdAt: { lte: before.createdAt },
            OR: [
              { createdAt: { lt: before.createdAt } },
              { createdAt: before.createdAt, id: { lt: before.id } },
            ],
          }),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true,
      amount: true,
      createdAt: true,
      user: { select: { id: true, displayName: true, avatarUrl: true } },
    },
  });

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ user, ...contribution }) => ({
      ...contribution,
      amount: formatMoney(contribution.amount),
      createdAt: contribution.createdAt.toISOString(),
      author: user,
    })),
    nextCursor: rows.length > limit && last ? encodeContributionCursor(last) : null,
  };
}

/**
 * Registra la aportación y suma su importe a la meta en una sola transacción. El bloqueo de la
 * meta serializa las aportaciones simultáneas y las ediciones (archivar, cambiar el objetivo):
 * el `increment` nunca pierde sumas y el estado se calcula sobre el importe ya actualizado.
 */
export async function addContribution(
  prisma: PrismaClient,
  budgetId: string,
  goalId: string,
  userId: string,
  amount: string,
): Promise<{ contribution: ContributionView; goal: GoalView }> {
  const contribution = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Goal" WHERE "id" = ${goalId} FOR UPDATE`;
    const goal = await tx.goal.findFirst({
      where: { id: goalId, budgetId },
      select: { status: true, title: true },
    });
    if (!goal) throw goalNotFound();
    if (goal.status === 'ARCHIVED') {
      throw new ConflictError('No se puede aportar a una meta archivada');
    }

    const created = await tx.goalContribution.create({
      data: { goalId, userId, amount },
      select: { id: true, amount: true, userId: true, createdAt: true },
    });
    const updated = await tx.goal.update({
      where: { id: goalId },
      data: { currentAmount: { increment: amount } },
      select: { currentAmount: true, targetAmount: true },
    });
    const status = statusFor(updated.currentAmount, updated.targetAmount, false);
    await tx.goal.update({ where: { id: goalId }, data: { status } });

    const target = { goalId, title: goal.title };
    await logActivity(tx, {
      budgetId,
      userId,
      action: 'GOAL_CONTRIBUTION',
      metadata: { ...target, contributionId: created.id, amount: formatMoney(created.amount) },
    });
    await logIfReached(tx, { budgetId, userId, ...target }, goal.status, status);
    return created;
  }, LOCKING_TRANSACTION);

  return {
    contribution: {
      ...contribution,
      amount: formatMoney(contribution.amount),
      createdAt: contribution.createdAt.toISOString(),
    },
    goal: await getGoal(prisma, budgetId, goalId),
  };
}

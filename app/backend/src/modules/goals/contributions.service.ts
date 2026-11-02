import type { PrismaClient } from '../../generated/prisma/client.js';
import { ConflictError } from '../../shared/errors.js';
import { formatMoney } from '../../shared/money.js';
import { LOCKING_TRANSACTION } from '../../shared/transactions.js';
import { getGoal, type GoalView, goalNotFound, statusFor } from './goals.service.js';

export interface ContributionView {
  id: string;
  amount: string;
  userId: string | null;
  createdAt: string;
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
      select: { status: true },
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
    await tx.goal.update({
      where: { id: goalId },
      data: { status: statusFor(updated.currentAmount, updated.targetAmount, false) },
    });
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

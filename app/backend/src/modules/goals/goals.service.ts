import type { GoalStatus, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { formatDate, parseDate } from '../../shared/date.js';
import { NotFoundError } from '../../shared/errors.js';
import { formatMoney } from '../../shared/money.js';
import { LOCKING_TRANSACTION } from '../../shared/transactions.js';
import { changesBetween, hasChanges, logActivity } from '../activity/activity.service.js';

const goalSelect = {
  id: true,
  title: true,
  targetAmount: true,
  currentAmount: true,
  deadline: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GoalSelect;

type Goal = Prisma.GoalGetPayload<{ select: typeof goalSelect }>;

export interface GoalView {
  id: string;
  title: string;
  targetAmount: string;
  currentAmount: string;
  /** `YYYY-MM-DD` o `null`. */
  deadline: string | null;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GoalUpdate {
  title?: string;
  targetAmount?: string;
  deadline?: string | null;
  /** `true` archiva; `false` desarchiva y recalcula el estado. */
  archived?: boolean;
}

function toView(goal: Goal): GoalView {
  return {
    ...goal,
    targetAmount: formatMoney(goal.targetAmount),
    currentAmount: formatMoney(goal.currentAmount),
    deadline: goal.deadline && formatDate(goal.deadline),
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

export function goalNotFound(): NotFoundError {
  return new NotFoundError('Meta no encontrada');
}

/** El estado no se fija desde fuera: se deriva de lo ahorrado frente al objetivo. */
export function statusFor(
  current: Prisma.Decimal,
  target: Prisma.Decimal | string,
  archived: boolean,
): GoalStatus {
  if (archived) return 'ARCHIVED';
  return current.gte(target) ? 'REACHED' : 'IN_PROGRESS';
}

export async function listGoals(
  prisma: PrismaClient,
  budgetId: string,
  status?: GoalStatus,
): Promise<GoalView[]> {
  const goals = await prisma.goal.findMany({
    where: { budgetId, ...(status === undefined ? {} : { status }) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: goalSelect,
  });
  return goals.map(toView);
}

export async function getGoal(
  prisma: PrismaClient,
  budgetId: string,
  goalId: string,
): Promise<GoalView> {
  const goal = await prisma.goal.findFirst({
    where: { id: goalId, budgetId },
    select: goalSelect,
  });
  if (!goal) throw goalNotFound();
  return toView(goal);
}

/** Registra `GOAL_REACHED` solo en la transición IN_PROGRESS → REACHED (una vez por logro). */
export async function logIfReached(
  tx: Prisma.TransactionClient,
  entry: { budgetId: string; userId: string; goalId: string; title: string },
  from: GoalStatus,
  to: GoalStatus,
): Promise<void> {
  if (from !== 'IN_PROGRESS' || to !== 'REACHED') return;
  const { budgetId, userId, goalId, title } = entry;
  await logActivity(tx, { budgetId, userId, action: 'GOAL_REACHED', metadata: { goalId, title } });
}

/** El permiso (`goal:manage`) lo comprueba la ruta con `requirePermission`. */
export async function createGoal(
  prisma: PrismaClient,
  budgetId: string,
  userId: string,
  { deadline, ...data }: { title: string; targetAmount: string; deadline?: string },
): Promise<GoalView> {
  return prisma.$transaction(async (tx) => {
    const goal = toView(
      await tx.goal.create({
        data: {
          ...data,
          budgetId,
          ...(deadline === undefined ? {} : { deadline: parseDate(deadline) }),
        },
        select: goalSelect,
      }),
    );
    await logActivity(tx, {
      budgetId,
      userId,
      action: 'GOAL_CREATED',
      metadata: { goalId: goal.id, title: goal.title, targetAmount: goal.targetAmount },
    });
    return goal;
  });
}

/**
 * Bloquea la meta para que el estado se calcule sobre un `currentAmount` que ninguna
 * contribución simultánea pueda cambiar entretanto. El permiso lo comprueba la ruta.
 * Actividad: `GOAL_UPDATED` (campos cambiados, o desarchivar), `GOAL_ARCHIVED` y
 * `GOAL_REACHED` si el nuevo objetivo ya está cubierto.
 */
export async function updateGoal(
  prisma: PrismaClient,
  budgetId: string,
  goalId: string,
  userId: string,
  { archived, deadline, ...data }: GoalUpdate,
): Promise<GoalView> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Goal" WHERE "id" = ${goalId} FOR UPDATE`;
    const goal = await tx.goal.findFirst({ where: { id: goalId, budgetId }, select: goalSelect });
    if (!goal) throw goalNotFound();
    const before = toView(goal);

    const status = statusFor(
      goal.currentAmount,
      data.targetAmount ?? goal.targetAmount,
      archived ?? goal.status === 'ARCHIVED',
    );
    const after = toView(
      await tx.goal.update({
        where: { id: goalId },
        data: {
          ...data,
          status,
          ...(deadline === undefined ? {} : { deadline: deadline && parseDate(deadline) }),
        },
        select: goalSelect,
      }),
    );

    const changes = changesBetween(before, {
      title: after.title,
      targetAmount: after.targetAmount,
      deadline: after.deadline,
    });
    if (before.status === 'ARCHIVED' && after.status !== 'ARCHIVED') {
      changes.archived = { from: true, to: false };
    }
    const target = { goalId, title: after.title };
    if (hasChanges(changes)) {
      await logActivity(tx, {
        budgetId,
        userId,
        action: 'GOAL_UPDATED',
        metadata: { ...target, changes },
      });
    }
    if (before.status !== 'ARCHIVED' && after.status === 'ARCHIVED') {
      await logActivity(tx, { budgetId, userId, action: 'GOAL_ARCHIVED', metadata: target });
    }
    await logIfReached(tx, { budgetId, userId, ...target }, before.status, after.status);
    return after;
  }, LOCKING_TRANSACTION);
}

/** Borra la meta y, en cascada, sus contribuciones. El permiso lo comprueba la ruta. */
export async function deleteGoal(
  prisma: PrismaClient,
  budgetId: string,
  goalId: string,
  userId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const goal = await tx.goal.findFirst({
      where: { id: goalId, budgetId },
      select: { title: true },
    });
    if (!goal) throw goalNotFound();

    await tx.goal.delete({ where: { id: goalId } });
    await logActivity(tx, {
      budgetId,
      userId,
      action: 'GOAL_DELETED',
      metadata: { goalId, title: goal.title },
    });
  });
}

import type { GoalStatus, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { formatDate, parseDate } from '../../shared/date.js';
import { NotFoundError } from '../../shared/errors.js';
import { formatMoney } from '../../shared/money.js';
import { LOCKING_TRANSACTION } from '../../shared/transactions.js';

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

/** El permiso (`goal:manage`) lo comprueba la ruta con `requirePermission`. */
export async function createGoal(
  prisma: PrismaClient,
  budgetId: string,
  { deadline, ...data }: { title: string; targetAmount: string; deadline?: string },
): Promise<GoalView> {
  return toView(
    await prisma.goal.create({
      data: {
        ...data,
        budgetId,
        ...(deadline === undefined ? {} : { deadline: parseDate(deadline) }),
      },
      select: goalSelect,
    }),
  );
}

/**
 * Bloquea la meta para que el estado se calcule sobre un `currentAmount` que ninguna
 * contribución simultánea pueda cambiar entretanto. El permiso lo comprueba la ruta.
 */
export async function updateGoal(
  prisma: PrismaClient,
  budgetId: string,
  goalId: string,
  { archived, deadline, ...data }: GoalUpdate,
): Promise<GoalView> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Goal" WHERE "id" = ${goalId} FOR UPDATE`;
    const goal = await tx.goal.findFirst({
      where: { id: goalId, budgetId },
      select: { currentAmount: true, targetAmount: true, status: true },
    });
    if (!goal) throw goalNotFound();

    const status = statusFor(
      goal.currentAmount,
      data.targetAmount ?? goal.targetAmount,
      archived ?? goal.status === 'ARCHIVED',
    );
    return toView(
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
  }, LOCKING_TRANSACTION);
}

/** Borra la meta y, en cascada, sus contribuciones. El permiso lo comprueba la ruta. */
export async function deleteGoal(
  prisma: PrismaClient,
  budgetId: string,
  goalId: string,
): Promise<void> {
  const { count } = await prisma.goal.deleteMany({ where: { id: goalId, budgetId } });
  if (count === 0) throw goalNotFound();
}

import type { Currency, Prisma, PrismaClient, Role } from '../../generated/prisma/client.js';
import { ForbiddenError, LimitExceededError, NotFoundError } from '../../shared/errors.js';
import { MAX_BUDGETS_PER_USER } from './limits.js';

const membershipSelect = {
  role: true,
  budget: {
    select: {
      id: true,
      name: true,
      currency: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { members: true } },
    },
  },
} satisfies Prisma.BudgetMemberSelect;

type Membership = Prisma.BudgetMemberGetPayload<{ select: typeof membershipSelect }>;

export interface BudgetView {
  id: string;
  name: string;
  currency: Currency;
  role: Role;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

function toView({ role, budget }: Membership): BudgetView {
  return {
    id: budget.id,
    name: budget.name,
    currency: budget.currency,
    role,
    memberCount: budget._count.members,
    createdAt: budget.createdAt.toISOString(),
    updatedAt: budget.updatedAt.toISOString(),
  };
}

/**
 * Crea el presupuesto con el creador como OWNER. El bloqueo de la fila del usuario serializa
 * las creaciones simultáneas para que el recuento del límite no pueda quedarse obsoleto.
 */
export async function createBudget(
  prisma: PrismaClient,
  userId: string,
  data: { name: string; currency?: Currency },
): Promise<BudgetView> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR UPDATE`;

    const budgets = await tx.budgetMember.count({ where: { userId } });
    if (budgets >= MAX_BUDGETS_PER_USER) {
      throw new LimitExceededError(
        `No puedes pertenecer a más de ${MAX_BUDGETS_PER_USER} presupuestos`,
      );
    }

    const budget = await tx.budget.create({
      data: { ...data, members: { create: { userId, role: 'OWNER' } } },
      select: { id: true },
    });
    return toView(
      await tx.budgetMember.findUniqueOrThrow({
        where: { userId_budgetId: { userId, budgetId: budget.id } },
        select: membershipSelect,
      }),
    );
  });
}

export async function listBudgets(prisma: PrismaClient, userId: string): Promise<BudgetView[]> {
  const memberships = await prisma.budgetMember.findMany({
    where: { userId },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    select: membershipSelect,
  });
  return memberships.map(toView);
}

/** Lanza 404 tanto si no existe como si el usuario no es miembro (no se revela su existencia). */
export async function getBudget(
  prisma: PrismaClient,
  userId: string,
  budgetId: string,
): Promise<BudgetView> {
  const membership = await prisma.budgetMember.findUnique({
    where: { userId_budgetId: { userId, budgetId } },
    select: membershipSelect,
  });
  if (!membership) throw new NotFoundError('Presupuesto no encontrado');
  return toView(membership);
}

/**
 * Exige que el usuario sea OWNER: 404 si no es miembro (como en `getBudget`), 403 si lo es
 * con otro rol. Se centralizará en la matriz de permisos de la Fase 3.3.
 */
async function requireOwner(prisma: PrismaClient, userId: string, budgetId: string) {
  const membership = await prisma.budgetMember.findUnique({
    where: { userId_budgetId: { userId, budgetId } },
    select: { role: true },
  });
  if (!membership) throw new NotFoundError('Presupuesto no encontrado');
  if (membership.role !== 'OWNER') {
    throw new ForbiddenError('Solo el propietario puede modificar o borrar el presupuesto');
  }
}

export async function updateBudget(
  prisma: PrismaClient,
  userId: string,
  budgetId: string,
  data: { name?: string; currency?: Currency },
): Promise<BudgetView> {
  await requireOwner(prisma, userId, budgetId);
  await prisma.budget.update({ where: { id: budgetId }, data, select: { id: true } });
  return getBudget(prisma, userId, budgetId);
}

/** Borra el presupuesto; sus membresías e invitaciones caen en cascada. */
export async function deleteBudget(
  prisma: PrismaClient,
  userId: string,
  budgetId: string,
): Promise<void> {
  await requireOwner(prisma, userId, budgetId);
  await prisma.budget.delete({ where: { id: budgetId } });
}

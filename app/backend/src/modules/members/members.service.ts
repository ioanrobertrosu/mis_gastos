import type { Prisma, PrismaClient, Role } from '../../generated/prisma/client.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { LOCKING_TRANSACTION } from '../../shared/transactions.js';
import { logActivity } from '../activity/activity.service.js';
import { type BudgetView, getBudget } from '../budgets/budgets.service.js';
import { budgetNotFound, roleForbidden } from '../budgets/errors.js';

const memberSelect = {
  role: true,
  joinedAt: true,
  user: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
} satisfies Prisma.BudgetMemberSelect;

type Member = Prisma.BudgetMemberGetPayload<{ select: typeof memberSelect }>;

export interface MemberView {
  userId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: Role;
  joinedAt: string;
}

function toView({ role, joinedAt, user }: Member): MemberView {
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role,
    joinedAt: joinedAt.toISOString(),
  };
}

function memberNotFound(): NotFoundError {
  return new NotFoundError('Miembro no encontrado');
}

/** La propiedad solo cambia mediante una transferencia explícita; nunca degradando al OWNER. */
function ownerConflict(): ConflictError {
  return new ConflictError('El propietario debe transferir la propiedad antes');
}

async function findRole(
  tx: Prisma.TransactionClient,
  budgetId: string,
  userId: string,
): Promise<Role | undefined> {
  const member = await tx.budgetMember.findUnique({
    where: { userId_budgetId: { userId, budgetId } },
    select: { role: true },
  });
  return member?.role;
}

/**
 * Bloquea la fila del presupuesto y relee el rol del usuario. Toda operación que cambie roles o
 * membresías pasa por aquí, de modo que se serializan y siempre queda exactamente un OWNER: el
 * rol que comprobó `requirePermission` puede haber cambiado mientras la petición esperaba.
 */
async function lockMembership(
  tx: Prisma.TransactionClient,
  budgetId: string,
  userId: string,
): Promise<Role> {
  await tx.$queryRaw`SELECT 1 FROM "Budget" WHERE "id" = ${budgetId} FOR UPDATE`;
  const role = await findRole(tx, budgetId, userId);
  if (!role) throw budgetNotFound();
  return role;
}

async function lockAsOwner(
  tx: Prisma.TransactionClient,
  budgetId: string,
  userId: string,
): Promise<void> {
  if ((await lockMembership(tx, budgetId, userId)) !== 'OWNER') throw roleForbidden();
}

export async function listMembers(prisma: PrismaClient, budgetId: string): Promise<MemberView[]> {
  const members = await prisma.budgetMember.findMany({
    where: { budgetId },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    select: memberSelect,
  });
  return members.map(toView);
}

/** El permiso (`member:manage`) lo comprueba la ruta y se revalida bajo el bloqueo. */
export async function changeMemberRole(
  prisma: PrismaClient,
  budgetId: string,
  ownerId: string,
  userId: string,
  role: Role,
): Promise<MemberView> {
  return prisma.$transaction(async (tx) => {
    await lockAsOwner(tx, budgetId, ownerId);
    const current = await findRole(tx, budgetId, userId);
    if (!current) throw memberNotFound();
    if (current === 'OWNER') throw ownerConflict();

    const member = await tx.budgetMember.update({
      where: { userId_budgetId: { userId, budgetId } },
      data: { role },
      select: memberSelect,
    });
    if (current !== role) {
      await logActivity(tx, {
        budgetId,
        userId: ownerId,
        action: 'MEMBER_ROLE_CHANGED',
        metadata: { userId, from: current, to: role },
      });
    }
    return toView(member);
  }, LOCKING_TRANSACTION);
}

/** El permiso (`member:manage`) lo comprueba la ruta y se revalida bajo el bloqueo. */
export async function removeMember(
  prisma: PrismaClient,
  budgetId: string,
  ownerId: string,
  userId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockAsOwner(tx, budgetId, ownerId);
    const current = await findRole(tx, budgetId, userId);
    if (!current) throw memberNotFound();
    if (current === 'OWNER') throw ownerConflict();

    await tx.budgetMember.delete({ where: { userId_budgetId: { userId, budgetId } } });
    await logActivity(tx, {
      budgetId,
      userId: ownerId,
      action: 'MEMBER_REMOVED',
      metadata: { userId },
    });
  }, LOCKING_TRANSACTION);
}

export async function leaveBudget(
  prisma: PrismaClient,
  budgetId: string,
  userId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if ((await lockMembership(tx, budgetId, userId)) === 'OWNER') throw ownerConflict();
    await tx.budgetMember.delete({ where: { userId_budgetId: { userId, budgetId } } });
    await logActivity(tx, { budgetId, userId, action: 'MEMBER_LEFT', metadata: { userId } });
  }, LOCKING_TRANSACTION);
}

/**
 * Intercambia los roles de forma atómica: el destinatario pasa a OWNER y el OWNER actual asume
 * el rol que tenía el destinatario. Devuelve el presupuesto visto por el antiguo OWNER.
 */
export async function transferOwnership(
  prisma: PrismaClient,
  budgetId: string,
  ownerId: string,
  targetId: string,
): Promise<BudgetView> {
  if (ownerId === targetId) throw new ConflictError('Ya eres el propietario de este presupuesto');

  await prisma.$transaction(async (tx) => {
    await lockAsOwner(tx, budgetId, ownerId);
    const targetRole = await findRole(tx, budgetId, targetId);
    if (!targetRole) throw memberNotFound();

    await tx.budgetMember.update({
      where: { userId_budgetId: { userId: ownerId, budgetId } },
      data: { role: targetRole },
    });
    await tx.budgetMember.update({
      where: { userId_budgetId: { userId: targetId, budgetId } },
      data: { role: 'OWNER' },
    });
    await logActivity(tx, {
      budgetId,
      userId: ownerId,
      action: 'OWNERSHIP_TRANSFERRED',
      metadata: { from: ownerId, to: targetId },
    });
  }, LOCKING_TRANSACTION);

  return getBudget(prisma, ownerId, budgetId);
}

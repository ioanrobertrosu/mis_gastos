import type { PrismaClient, Role } from '../../generated/prisma/client.js';
import {
  ConflictError,
  GoneError,
  LimitExceededError,
  NotFoundError,
} from '../../shared/errors.js';
import { LOCKING_TRANSACTION } from '../../shared/transactions.js';
import { logActivity } from '../activity/activity.service.js';
import { type BudgetView, getBudget } from '../budgets/budgets.service.js';
import { MAX_BUDGETS_PER_USER, MAX_MEMBERS_PER_BUDGET } from '../budgets/limits.js';

const HOUR_MS = 3_600_000;
export const DEFAULT_INVITATION_HOURS = 48;

export interface InvitationView {
  id: string;
  token: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

function invitationNotFound(): NotFoundError {
  return new NotFoundError('Invitación no encontrada');
}

export async function createInvitation(
  prisma: PrismaClient,
  data: { budgetId: string; createdById: string; role?: Role; expiresInHours?: number },
): Promise<InvitationView> {
  const { budgetId, createdById, role, expiresInHours = DEFAULT_INVITATION_HOURS } = data;
  const invite = await prisma.oneTimeInvite.create({
    data: {
      budgetId,
      createdById,
      ...(role ? { role } : {}),
      expiresAt: new Date(Date.now() + expiresInHours * HOUR_MS),
    },
    select: { id: true, token: true, role: true, expiresAt: true, createdAt: true },
  });
  return {
    ...invite,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
  };
}

interface LockedInvite {
  budgetId: string;
  role: Role;
  expiresAt: Date;
  isUsed: boolean;
}

/**
 * Acepta la invitación en una única transacción. Orden de bloqueos: invitación → presupuesto →
 * usuario. El de la invitación impide que dos aceptaciones simultáneas la usen dos veces; los
 * del presupuesto y el usuario protegen los límites de miembros y de presupuestos.
 */
export async function acceptInvitation(
  prisma: PrismaClient,
  userId: string,
  token: string,
): Promise<BudgetView> {
  const budgetId = await prisma.$transaction(async (tx) => {
    const [invite] = await tx.$queryRaw<LockedInvite[]>`
      SELECT "budgetId", "role", "expiresAt", "isUsed" FROM "OneTimeInvite"
      WHERE "token" = ${token} FOR UPDATE`;
    if (!invite) throw invitationNotFound();
    if (invite.isUsed) throw new GoneError('INVITATION_USED', 'La invitación ya se ha utilizado');
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new GoneError('INVITATION_EXPIRED', 'La invitación ha caducado');
    }

    await tx.$queryRaw`SELECT 1 FROM "Budget" WHERE "id" = ${invite.budgetId} FOR UPDATE`;
    await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR UPDATE`;

    const alreadyMember = await tx.budgetMember.findUnique({
      where: { userId_budgetId: { userId, budgetId: invite.budgetId } },
      select: { id: true },
    });
    if (alreadyMember) throw new ConflictError('Ya eres miembro de este presupuesto');

    if ((await tx.budgetMember.count({ where: { userId } })) >= MAX_BUDGETS_PER_USER) {
      throw new LimitExceededError(
        `No puedes pertenecer a más de ${MAX_BUDGETS_PER_USER} presupuestos`,
      );
    }
    const members = await tx.budgetMember.count({ where: { budgetId: invite.budgetId } });
    if (members >= MAX_MEMBERS_PER_BUDGET) {
      throw new LimitExceededError(
        `El presupuesto ya tiene el máximo de ${MAX_MEMBERS_PER_BUDGET} miembros`,
      );
    }

    await tx.budgetMember.create({
      data: { userId, budgetId: invite.budgetId, role: invite.role },
    });
    await tx.oneTimeInvite.update({ where: { token }, data: { isUsed: true } });
    await logActivity(tx, {
      budgetId: invite.budgetId,
      userId,
      action: 'MEMBER_JOINED',
      metadata: { userId, role: invite.role },
    });
    return invite.budgetId;
  }, LOCKING_TRANSACTION);

  return getBudget(prisma, userId, budgetId);
}

export async function revokeInvitation(
  prisma: PrismaClient,
  budgetId: string,
  inviteId: string,
): Promise<void> {
  const { count } = await prisma.oneTimeInvite.deleteMany({ where: { id: inviteId, budgetId } });
  if (count === 0) throw invitationNotFound();
}

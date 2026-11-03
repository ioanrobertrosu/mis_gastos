import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { LOCKING_TRANSACTION } from '../../shared/transactions.js';
import { logActivity } from '../activity/activity.service.js';

export const DELETED_USER_NAME = 'Usuario Eliminado';

async function lockBudgets(tx: Prisma.TransactionClient, budgetIds: string[]): Promise<void> {
  // Siempre en el mismo orden para no provocar interbloqueos entre borrados simultáneos.
  for (const id of [...budgetIds].sort()) {
    await tx.$queryRaw`SELECT 1 FROM "Budget" WHERE "id" = ${id} FOR UPDATE`;
  }
}

async function membershipsOf(tx: Prisma.TransactionClient, userId: string) {
  return tx.budgetMember.findMany({ where: { userId }, select: { budgetId: true, role: true } });
}

/**
 * Borra la cuenta en una transacción (PRD §5.3):
 * - En cada presupuesto donde es OWNER, la propiedad pasa al miembro con `joinedAt` más antiguo;
 *   si era el único miembro, el presupuesto se borra en cascada.
 * - Sale de todos sus presupuestos y pierde sus identidades.
 * - El `User` se conserva anonimizado (soft delete) para preservar el historial de movimientos;
 *   el email se sustituye para liberar el original.
 *
 * Bloqueos: presupuestos → usuario, el mismo orden que la aceptación de invitaciones.
 */
export async function deleteAccount(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const locked = (await membershipsOf(tx, userId)).map(({ budgetId }) => budgetId);
    await lockBudgets(tx, locked);
    await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR UPDATE`;

    // Releer bajo el bloqueo: una invitación aceptada mientras tanto añade un presupuesto.
    const memberships = await membershipsOf(tx, userId);
    await lockBudgets(
      tx,
      memberships.map(({ budgetId }) => budgetId).filter((id) => !locked.includes(id)),
    );

    const reason = 'ACCOUNT_DELETED';
    for (const { budgetId, role } of memberships) {
      if (role === 'OWNER') {
        const successor = await tx.budgetMember.findFirst({
          where: { budgetId, userId: { not: userId } },
          orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
          select: { id: true, userId: true },
        });
        if (!successor) {
          // Único miembro: el presupuesto (y su actividad) se borra en cascada.
          await tx.budget.delete({ where: { id: budgetId } });
          continue;
        }
        await tx.budgetMember.update({ where: { id: successor.id }, data: { role: 'OWNER' } });
        await logActivity(tx, {
          budgetId,
          userId,
          action: 'OWNERSHIP_TRANSFERRED',
          metadata: { from: userId, to: successor.userId, reason },
        });
      }
      await logActivity(tx, {
        budgetId,
        userId,
        action: 'MEMBER_LEFT',
        metadata: { userId, reason },
      });
    }

    await tx.budgetMember.deleteMany({ where: { userId } });
    await tx.identity.deleteMany({ where: { userId } });
    await tx.user.update({
      where: { id: userId },
      data: {
        email: `deleted-${userId}@deleted.invalid`,
        displayName: DELETED_USER_NAME,
        avatarUrl: null,
        deletedAt: new Date(),
      },
    });
  }, LOCKING_TRANSACTION);
}

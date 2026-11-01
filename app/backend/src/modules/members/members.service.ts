import type { Prisma, PrismaClient, Role } from '../../generated/prisma/client.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';

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
  prisma: PrismaClient,
  budgetId: string,
  userId: string,
): Promise<Role | undefined> {
  const member = await prisma.budgetMember.findUnique({
    where: { userId_budgetId: { userId, budgetId } },
    select: { role: true },
  });
  return member?.role;
}

export async function listMembers(prisma: PrismaClient, budgetId: string): Promise<MemberView[]> {
  const members = await prisma.budgetMember.findMany({
    where: { budgetId },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    select: memberSelect,
  });
  return members.map(toView);
}

/** El permiso (`member:manage`) lo comprueba la ruta con `requirePermission`. */
export async function changeMemberRole(
  prisma: PrismaClient,
  budgetId: string,
  userId: string,
  role: Role,
): Promise<MemberView> {
  const current = await findRole(prisma, budgetId, userId);
  if (!current) throw memberNotFound();
  if (current === 'OWNER') throw ownerConflict();

  return toView(
    await prisma.budgetMember.update({
      where: { userId_budgetId: { userId, budgetId } },
      data: { role },
      select: memberSelect,
    }),
  );
}

/** El permiso (`member:manage`) lo comprueba la ruta con `requirePermission`. */
export async function removeMember(
  prisma: PrismaClient,
  budgetId: string,
  userId: string,
): Promise<void> {
  const current = await findRole(prisma, budgetId, userId);
  if (!current) throw memberNotFound();
  if (current === 'OWNER') throw ownerConflict();

  await prisma.budgetMember.delete({ where: { userId_budgetId: { userId, budgetId } } });
}

/** La pertenencia la comprueba la ruta con `requirePermission`, que deja el rol en la petición. */
export async function leaveBudget(
  prisma: PrismaClient,
  budgetId: string,
  userId: string,
  role: Role,
): Promise<void> {
  if (role === 'OWNER') throw ownerConflict();
  await prisma.budgetMember.delete({ where: { userId_budgetId: { userId, budgetId } } });
}

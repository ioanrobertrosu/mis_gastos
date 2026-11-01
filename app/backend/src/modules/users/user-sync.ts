import type { PrismaClient } from '../../generated/prisma/client.js';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../../shared/errors.js';

/** Datos del JWT necesarios para sincronizar al usuario. */
export interface IdentityClaims {
  sub: string;
  email: string | undefined;
  provider: string;
  providerId: string;
}

/**
 * Garantiza que existen el `User` (id = sub) y la `Identity` del proveedor con el que entra.
 * Sin transacción: cada paso es idempotente (`ON CONFLICT DO NOTHING`), por lo que los
 * primeros accesos simultáneos no fallan y un estado parcial se completa en la siguiente petición.
 * Una cuenta borrada (soft delete) recibe 401 y nunca se reactiva.
 */
export async function syncUser(prisma: PrismaClient, claims: IdentityClaims): Promise<void> {
  const { sub, email, provider, providerId } = claims;

  // Camino habitual: la identidad ya existe (y con ella, su usuario).
  const identity = await prisma.identity.findUnique({
    where: { provider_providerId: { provider, providerId } },
    select: { user: { select: { deletedAt: true } } },
  });
  if (identity) {
    if (identity.user.deletedAt) throw new UnauthorizedError();
    return;
  }

  const user = await findUser(prisma, sub);
  if (user?.deletedAt) throw new UnauthorizedError();
  if (!user) {
    if (!email) throw new ForbiddenError('La cuenta necesita un email para registrarse');

    const { count } = await prisma.user.createMany({
      data: [{ id: sub, email }],
      skipDuplicates: true,
    });
    // `count === 0` sin usuario con ese id: el conflicto lo ha provocado el email.
    if (count === 0 && !(await findUser(prisma, sub))) {
      throw new ConflictError('El email ya está asociado a otra cuenta');
    }
  }

  await prisma.identity.createMany({
    data: [{ userId: sub, provider, providerId }],
    skipDuplicates: true,
  });
}

async function findUser(prisma: PrismaClient, id: string) {
  return prisma.user.findUnique({ where: { id }, select: { deletedAt: true } });
}

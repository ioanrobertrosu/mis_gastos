import type { ActivityAction } from '../../generated/prisma/enums.js';
import { Prisma } from '../../generated/prisma/client.js';
import { formatMoney, percentOf } from '../../shared/money.js';
import { monthRange } from '../../shared/month.js';

const WARNING_RATIO = new Prisma.Decimal('0.9');

/** Alerta que corresponde al gasto, en decimal exacto: 89,99 % no llega al 90 % aunque redondee. */
function alertFor(spent: Prisma.Decimal, limit: Prisma.Decimal): ActivityAction | null {
  if (limit.isZero()) return null;
  if (spent.gt(limit)) return 'CATEGORY_LIMIT_EXCEEDED';
  return spent.gte(limit.mul(WARNING_RATIO)) ? 'CATEGORY_90_PERCENT' : null;
}

/**
 * Comprueba el gasto de la categoría en un mes (sin mes, el actual en UTC) y registra su alerta,
 * una sola vez por acción, categoría y mes gracias a la clave única `dedupeKey`.
 *
 * El bloqueo de la categoría serializa las comprobaciones simultáneas: sin él, cada transacción
 * sumaría sin ver el gasto aún sin confirmar de las demás y la alerta podría perderse. Es
 * `NO KEY UPDATE` porque insertar una transacción ya retiene `KEY SHARE` sobre la categoría (por
 * la clave foránea) y `FOR UPDATE` provocaría un interbloqueo entre inserciones simultáneas.
 */
export async function evaluateCategoryAlerts(
  tx: Prisma.TransactionClient,
  entry: { budgetId: string; categoryId: string; userId: string; month?: string },
): Promise<void> {
  const { budgetId, categoryId, userId, month } = entry;
  await tx.$queryRaw`SELECT 1 FROM "Category" WHERE "id" = ${categoryId} FOR NO KEY UPDATE`;

  const category = await tx.category.findUniqueOrThrow({
    where: { id: categoryId },
    select: { name: true, monthlyLimit: true },
  });
  const { start, end } = monthRange(month);
  const { _sum } = await tx.transaction.aggregate({
    where: { categoryId, date: { gte: start, lt: end } },
    _sum: { amount: true },
  });

  const spent = _sum.amount ?? new Prisma.Decimal(0);
  const action = alertFor(spent, category.monthlyLimit);
  if (!action) return;

  const alertMonth = start.toISOString().slice(0, 7);
  await tx.activityLog.createMany({
    data: [
      {
        budgetId,
        userId,
        action,
        dedupeKey: `${action}:${categoryId}:${alertMonth}`,
        metadata: {
          categoryId,
          name: category.name,
          month: alertMonth,
          spent: formatMoney(spent),
          monthlyLimit: formatMoney(category.monthlyLimit),
          percentUsed: percentOf(spent, category.monthlyLimit),
        },
      },
    ],
    skipDuplicates: true,
  });
}

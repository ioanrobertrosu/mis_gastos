import { type Currency, Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { formatMoney, percentOf } from '../../shared/money.js';
import { monthRange } from '../../shared/month.js';

export interface BudgetSummary {
  /** `YYYY-MM`. */
  month: string;
  currency: Currency;
  /** Suma de los límites de las categorías activas. */
  allocated: string;
  /** Todo lo gastado en el mes, también en categorías desactivadas después. */
  spent: string;
  /** `allocated - spent`; negativo si se ha gastado de más. */
  remaining: string;
  percentUsed: number | null;
}

/** Resumen base cero del mes. Las sumas las hace la BD en NUMERIC (exactas). */
export async function getBudgetSummary(
  prisma: PrismaClient,
  budgetId: string,
  month?: string,
): Promise<BudgetSummary> {
  const { start, end } = monthRange(month);
  const [budget, limits, expenses] = await Promise.all([
    prisma.budget.findUniqueOrThrow({ where: { id: budgetId }, select: { currency: true } }),
    prisma.category.aggregate({
      where: { budgetId, isActive: true },
      _sum: { monthlyLimit: true },
    }),
    prisma.transaction.aggregate({
      where: { budgetId, date: { gte: start, lt: end } },
      _sum: { amount: true },
    }),
  ]);

  const allocated = limits._sum.monthlyLimit ?? new Prisma.Decimal(0);
  const spent = expenses._sum.amount ?? new Prisma.Decimal(0);
  return {
    month: start.toISOString().slice(0, 7),
    currency: budget.currency,
    allocated: formatMoney(allocated),
    spent: formatMoney(spent),
    remaining: formatMoney(allocated.minus(spent)),
    percentUsed: percentOf(spent, allocated),
  };
}

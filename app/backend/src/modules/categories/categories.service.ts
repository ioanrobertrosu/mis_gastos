import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { formatMoney } from '../../shared/money.js';
import { monthRange } from '../../shared/month.js';
import { categoryNotFound } from './errors.js';

const categorySelect = {
  id: true,
  name: true,
  monthlyLimit: true,
  icon: true,
  colorHex: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

type Category = Prisma.CategoryGetPayload<{ select: typeof categorySelect }>;

export interface CategoryView {
  id: string;
  name: string;
  monthlyLimit: string;
  icon: string;
  colorHex: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryInput {
  name?: string;
  monthlyLimit?: string;
  icon?: string;
  colorHex?: string;
  isActive?: boolean;
}

function toView(category: Category): CategoryView {
  return {
    ...category,
    monthlyLimit: formatMoney(category.monthlyLimit),
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

export interface CategoryWithSpending extends CategoryView {
  /** Gasto del mes, con 2 decimales. */
  spent: string;
  /** `spent / monthlyLimit` en %, con 1 decimal; `null` si el límite es 0. Puede superar 100. */
  percentUsed: number | null;
}

/** Porcentaje exacto en decimal, redondeado a 1 decimal (mitad hacia arriba). */
function percentOf(spent: Prisma.Decimal, limit: Prisma.Decimal): number | null {
  if (limit.isZero()) return null;
  return spent.div(limit).mul(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

export async function listCategories(
  prisma: PrismaClient,
  budgetId: string,
  { includeInactive = false, month }: { includeInactive?: boolean; month?: string } = {},
): Promise<CategoryWithSpending[]> {
  const { start, end } = monthRange(month);
  const [categories, totals] = await Promise.all([
    prisma.category.findMany({
      where: { budgetId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: categorySelect,
    }),
    // La suma la hace la BD en NUMERIC: exacta, sin pasar por coma flotante.
    prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { budgetId, date: { gte: start, lt: end } },
      _sum: { amount: true },
    }),
  ]);

  const spentBy = new Map(totals.map(({ categoryId, _sum }) => [categoryId, _sum.amount]));
  return categories.map((category) => {
    const spent = spentBy.get(category.id) ?? new Prisma.Decimal(0);
    return {
      ...toView(category),
      spent: formatMoney(spent),
      percentUsed: percentOf(spent, category.monthlyLimit),
    };
  });
}

/** El permiso (`category:manage`) lo comprueba la ruta con `requirePermission`. */
export async function createCategory(
  prisma: PrismaClient,
  budgetId: string,
  data: CategoryInput & { name: string; monthlyLimit: string },
): Promise<CategoryView> {
  return toView(
    await prisma.category.create({ data: { ...data, budgetId }, select: categorySelect }),
  );
}

/**
 * Filtrar también por `budgetId` impide tocar la categoría de otro presupuesto, aunque se
 * conozca su id: responde 404 igual que si no existiera.
 */
export async function updateCategory(
  prisma: PrismaClient,
  budgetId: string,
  categoryId: string,
  data: CategoryInput,
): Promise<CategoryView> {
  const { count } = await prisma.category.updateMany({ where: { id: categoryId, budgetId }, data });
  if (count === 0) throw categoryNotFound();
  return toView(
    await prisma.category.findUniqueOrThrow({ where: { id: categoryId }, select: categorySelect }),
  );
}

/** Soft delete idempotente: sus transacciones se conservan. */
export async function deactivateCategory(
  prisma: PrismaClient,
  budgetId: string,
  categoryId: string,
): Promise<void> {
  const { count } = await prisma.category.updateMany({
    where: { id: categoryId, budgetId },
    data: { isActive: false },
  });
  if (count === 0) throw categoryNotFound();
}

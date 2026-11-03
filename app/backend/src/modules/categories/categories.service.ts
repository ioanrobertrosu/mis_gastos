import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { formatMoney, percentOf } from '../../shared/money.js';
import { monthRange } from '../../shared/month.js';
import { changesBetween, hasChanges, logActivity } from '../activity/activity.service.js';
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
  userId: string,
  data: CategoryInput & { name: string; monthlyLimit: string },
): Promise<CategoryView> {
  return prisma.$transaction(async (tx) => {
    const category = toView(
      await tx.category.create({ data: { ...data, budgetId }, select: categorySelect }),
    );
    await logActivity(tx, {
      budgetId,
      userId,
      action: 'CATEGORY_CREATED',
      metadata: {
        categoryId: category.id,
        name: category.name,
        monthlyLimit: category.monthlyLimit,
      },
    });
    return category;
  });
}

/** Busca la categoría dentro del presupuesto: la de otro presupuesto responde 404 igual que si no existiera. */
async function findInBudget(tx: Prisma.TransactionClient, budgetId: string, categoryId: string) {
  const category = await tx.category.findFirst({
    where: { id: categoryId, budgetId },
    select: categorySelect,
  });
  if (!category) throw categoryNotFound();
  return toView(category);
}

/**
 * Registra la reactivación (si la hay) y, aparte, los demás cambios: `CATEGORY_LIMIT_UPDATED`
 * si cambia el límite, `CATEGORY_UPDATED` en otro caso. Sin cambios reales no se registra nada.
 */
export async function updateCategory(
  prisma: PrismaClient,
  budgetId: string,
  categoryId: string,
  userId: string,
  data: CategoryInput,
): Promise<CategoryView> {
  return prisma.$transaction(async (tx) => {
    const before = await findInBudget(tx, budgetId, categoryId);
    const after = toView(
      await tx.category.update({ where: { id: categoryId }, data, select: categorySelect }),
    );

    const { isActive, ...changes } = changesBetween(before, {
      name: after.name,
      monthlyLimit: after.monthlyLimit,
      icon: after.icon,
      colorHex: after.colorHex,
      isActive: after.isActive,
    });
    const target = { categoryId, name: after.name };
    if (isActive) {
      await logActivity(tx, { budgetId, userId, action: 'CATEGORY_REACTIVATED', metadata: target });
    }
    if (hasChanges(changes)) {
      await logActivity(tx, {
        budgetId,
        userId,
        action: changes.monthlyLimit ? 'CATEGORY_LIMIT_UPDATED' : 'CATEGORY_UPDATED',
        metadata: { ...target, changes },
      });
    }
    return after;
  });
}

/** Soft delete idempotente (sus transacciones se conservan): solo se registra la primera vez. */
export async function deactivateCategory(
  prisma: PrismaClient,
  budgetId: string,
  categoryId: string,
  userId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const category = await findInBudget(tx, budgetId, categoryId);
    if (!category.isActive) return;

    await tx.category.update({ where: { id: categoryId }, data: { isActive: false } });
    await logActivity(tx, {
      budgetId,
      userId,
      action: 'CATEGORY_DEACTIVATED',
      metadata: { categoryId, name: category.name },
    });
  });
}

import type { Prisma, PrismaClient, Role } from '../../generated/prisma/client.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors.js';
import { formatDate, parseDate } from '../../shared/date.js';
import { formatMoney } from '../../shared/money.js';
import { LOCKING_TRANSACTION } from '../../shared/transactions.js';
import { changesBetween, hasChanges, logActivity } from '../activity/activity.service.js';
import { evaluateCategoryAlerts } from '../activity/alerts.service.js';
import { can } from '../budgets/permissions.js';
import { categoryNotFound } from '../categories/errors.js';
import { decodeCursor, encodeCursor } from './cursor.js';

const transactionSelect = {
  id: true,
  categoryId: true,
  amount: true,
  description: true,
  date: true,
  isRecurring: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TransactionSelect;

type Transaction = Prisma.TransactionGetPayload<{ select: typeof transactionSelect }>;

export interface TransactionView {
  id: string;
  categoryId: string;
  amount: string;
  description: string | null;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Solo marca informativa: no genera transacciones. */
  isRecurring: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionInput {
  categoryId?: string;
  amount?: string;
  description?: string | null;
  date?: string;
  isRecurring?: boolean;
}

/** Quién actúa y con qué rol en el presupuesto (lo deja `requirePermission` en la petición). */
export interface Actor {
  userId: string;
  role: Role;
}

function toView(transaction: Transaction): TransactionView {
  return {
    ...transaction,
    amount: formatMoney(transaction.amount),
    date: formatDate(transaction.date),
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}

function toData({ date, ...data }: TransactionInput) {
  return { ...data, ...(date === undefined ? {} : { date: parseDate(date) }) };
}

function transactionNotFound(): NotFoundError {
  return new NotFoundError('Transacción no encontrada');
}

/** La categoría debe ser de este presupuesto (si no, 404) y estar activa (si no, 409). */
async function assertUsableCategory(
  tx: Prisma.TransactionClient,
  budgetId: string,
  categoryId: string,
): Promise<void> {
  const category = await tx.category.findFirst({
    where: { id: categoryId, budgetId },
    select: { isActive: true },
  });
  if (!category) throw categoryNotFound();
  if (!category.isActive) throw new ConflictError('La categoría está desactivada');
}

/**
 * Devuelve la transacción si es de este presupuesto y el actor puede modificarla:
 * OWNER y EDITOR cualquiera; LIMITED_EDITOR solo las que creó él.
 */
async function findEditable(
  tx: Prisma.TransactionClient,
  budgetId: string,
  transactionId: string,
  actor: Actor,
): Promise<TransactionView> {
  const transaction = await tx.transaction.findFirst({
    where: { id: transactionId, budgetId },
    select: transactionSelect,
  });
  if (!transaction) throw transactionNotFound();
  if (!can(actor.role, 'transaction:edit-any') && transaction.createdById !== actor.userId) {
    throw new ForbiddenError('Solo puedes modificar las transacciones que has creado');
  }
  return toView(transaction);
}

export const DEFAULT_PAGE_SIZE = 20;

export interface TransactionFilters {
  limit?: number;
  cursor?: string;
  categoryId?: string;
  /** `YYYY-MM-DD`, ambos extremos incluidos. */
  from?: string;
  to?: string;
  isRecurring?: boolean;
}

export interface TransactionPage {
  items: TransactionView[];
  nextCursor: string | null;
}

/**
 * Paginación por cursor (keyset) en orden `date DESC, id DESC`: la página siguiente empieza
 * estrictamente después de la clave del cursor, así que borrar o añadir transacciones entre
 * peticiones no duplica ni salta elementos. Se lee uno de más para saber si hay otra página.
 */
export async function listTransactions(
  prisma: PrismaClient,
  budgetId: string,
  { limit = DEFAULT_PAGE_SIZE, cursor, categoryId, from, to, isRecurring }: TransactionFilters,
): Promise<TransactionPage> {
  if (from !== undefined && to !== undefined && from > to) {
    throw new ValidationError('La fecha inicial no puede ser posterior a la final');
  }
  const after = cursor === undefined ? undefined : decodeCursor(cursor);

  const rows = await prisma.transaction.findMany({
    where: {
      budgetId,
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(isRecurring === undefined ? {} : { isRecurring }),
      ...(from === undefined && to === undefined
        ? {}
        : {
            date: {
              ...(from === undefined ? {} : { gte: parseDate(from) }),
              ...(to === undefined ? {} : { lte: parseDate(to) }),
            },
          }),
      ...(after === undefined
        ? {}
        : {
            OR: [
              { date: { lt: parseDate(after.date) } },
              { date: parseDate(after.date), id: { lt: after.id } },
            ],
          }),
    },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: transactionSelect,
  });

  const items = rows.slice(0, limit).map(toView);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

/** El permiso (`transaction:create`) lo comprueba la ruta con `requirePermission`. */
export async function createTransaction(
  prisma: PrismaClient,
  budgetId: string,
  createdById: string,
  { date, ...data }: TransactionInput & { categoryId: string; amount: string; date: string },
): Promise<TransactionView> {
  return prisma.$transaction(async (tx) => {
    await assertUsableCategory(tx, budgetId, data.categoryId);
    const transaction = toView(
      await tx.transaction.create({
        data: { ...data, date: parseDate(date), budgetId, createdById },
        select: transactionSelect,
      }),
    );
    await logActivity(tx, {
      budgetId,
      userId: createdById,
      action: 'TRANSACTION_CREATED',
      metadata: {
        transactionId: transaction.id,
        categoryId: transaction.categoryId,
        amount: transaction.amount,
      },
    });
    await evaluateCategoryAlerts(tx, {
      budgetId,
      categoryId: transaction.categoryId,
      userId: createdById,
      month: transaction.date.slice(0, 7),
    });
    return transaction;
  }, LOCKING_TRANSACTION);
}

export async function getTransaction(
  prisma: PrismaClient,
  budgetId: string,
  transactionId: string,
): Promise<TransactionView> {
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, budgetId },
    select: transactionSelect,
  });
  if (!transaction) throw transactionNotFound();
  return toView(transaction);
}

/** El permiso (`transaction:edit-own`) lo comprueba la ruta; la autoría, este servicio. */
export async function updateTransaction(
  prisma: PrismaClient,
  budgetId: string,
  transactionId: string,
  actor: Actor,
  data: TransactionInput,
): Promise<TransactionView> {
  return prisma.$transaction(async (tx) => {
    const before = await findEditable(tx, budgetId, transactionId, actor);
    if (data.categoryId !== undefined) {
      await assertUsableCategory(tx, budgetId, data.categoryId);
    }
    const after = toView(
      await tx.transaction.update({
        where: { id: transactionId },
        data: toData(data),
        select: transactionSelect,
      }),
    );

    const changes = changesBetween(before, {
      categoryId: after.categoryId,
      amount: after.amount,
      description: after.description,
      date: after.date,
      isRecurring: after.isRecurring,
    });
    if (hasChanges(changes)) {
      await logActivity(tx, {
        budgetId,
        userId: actor.userId,
        action: 'TRANSACTION_UPDATED',
        metadata: { transactionId, changes },
      });
    }
    // Solo el destino puede ganar gasto: la categoría y el mes de origen, como mucho, lo pierden.
    if (changes.amount || changes.categoryId || changes.date) {
      await evaluateCategoryAlerts(tx, {
        budgetId,
        categoryId: after.categoryId,
        userId: actor.userId,
        month: after.date.slice(0, 7),
      });
    }
    return after;
  }, LOCKING_TRANSACTION);
}

/** El permiso (`transaction:edit-own`) lo comprueba la ruta; la autoría, este servicio. */
export async function deleteTransaction(
  prisma: PrismaClient,
  budgetId: string,
  transactionId: string,
  actor: Actor,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const transaction = await findEditable(tx, budgetId, transactionId, actor);
    await tx.transaction.delete({ where: { id: transactionId } });
    await logActivity(tx, {
      budgetId,
      userId: actor.userId,
      action: 'TRANSACTION_DELETED',
      metadata: {
        transactionId,
        categoryId: transaction.categoryId,
        amount: transaction.amount,
      },
    });
  });
}

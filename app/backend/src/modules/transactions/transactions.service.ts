import type { Prisma, PrismaClient, Role } from '../../generated/prisma/client.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors.js';
import { formatDate, parseDate } from '../../shared/date.js';
import { formatMoney } from '../../shared/money.js';
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
  prisma: PrismaClient,
  budgetId: string,
  categoryId: string,
): Promise<void> {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, budgetId },
    select: { isActive: true },
  });
  if (!category) throw categoryNotFound();
  if (!category.isActive) throw new ConflictError('La categoría está desactivada');
}

/**
 * Comprueba que la transacción es de este presupuesto y que el actor puede modificarla:
 * OWNER y EDITOR cualquiera; LIMITED_EDITOR solo las que creó él.
 */
async function assertEditable(
  prisma: PrismaClient,
  budgetId: string,
  transactionId: string,
  actor: Actor,
): Promise<void> {
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, budgetId },
    select: { createdById: true },
  });
  if (!transaction) throw transactionNotFound();
  if (!can(actor.role, 'transaction:edit-any') && transaction.createdById !== actor.userId) {
    throw new ForbiddenError('Solo puedes modificar las transacciones que has creado');
  }
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
  await assertUsableCategory(prisma, budgetId, data.categoryId);
  return toView(
    await prisma.transaction.create({
      data: { ...data, date: parseDate(date), budgetId, createdById },
      select: transactionSelect,
    }),
  );
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
  await assertEditable(prisma, budgetId, transactionId, actor);
  if (data.categoryId !== undefined) {
    await assertUsableCategory(prisma, budgetId, data.categoryId);
  }
  return toView(
    await prisma.transaction.update({
      where: { id: transactionId },
      data: toData(data),
      select: transactionSelect,
    }),
  );
}

/** El permiso (`transaction:edit-own`) lo comprueba la ruta; la autoría, este servicio. */
export async function deleteTransaction(
  prisma: PrismaClient,
  budgetId: string,
  transactionId: string,
  actor: Actor,
): Promise<void> {
  await assertEditable(prisma, budgetId, transactionId, actor);
  await prisma.transaction.delete({ where: { id: transactionId } });
}

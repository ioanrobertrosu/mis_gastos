import type { Prisma, PrismaClient, Role } from '../../generated/prisma/client.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { formatMoney } from '../../shared/money.js';
import { can } from '../budgets/permissions.js';
import { categoryNotFound } from '../categories/errors.js';

const transactionSelect = {
  id: true,
  categoryId: true,
  amount: true,
  description: true,
  date: true,
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
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionInput {
  categoryId?: string;
  amount?: string;
  description?: string | null;
  date?: string;
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

/** Las columnas `@db.Date` se leen y escriben como medianoche UTC. */
function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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

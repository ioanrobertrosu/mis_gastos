import { testPrisma } from './db.js';
import type { TestUser } from './users.js';

/** Crea una categoría directamente en la BD de test. */
export async function seedCategory(
  budgetId: string,
  data: { name?: string; monthlyLimit?: string; isActive?: boolean } = {},
): Promise<string> {
  const category = await testPrisma.category.create({
    data: { budgetId, name: 'Comida', monthlyLimit: '300.00', ...data },
  });
  return category.id;
}

/** Crea una transacción directamente en la BD de test (fecha `YYYY-MM-DD`). */
export async function seedTransaction(
  budgetId: string,
  categoryId: string,
  data: { createdBy?: TestUser; amount?: string; date?: string; description?: string } = {},
): Promise<string> {
  const { createdBy, amount = '10.00', date = '2026-10-15', description } = data;
  const transaction = await testPrisma.transaction.create({
    data: {
      budgetId,
      categoryId,
      createdById: createdBy?.sub ?? null,
      amount,
      date: new Date(`${date}T00:00:00.000Z`),
      ...(description === undefined ? {} : { description }),
    },
  });
  return transaction.id;
}

/** La transacción tal y como está en la BD, con importe y fecha como texto. */
export async function storedTransaction(transactionId: string) {
  const transaction = await testPrisma.transaction.findUnique({ where: { id: transactionId } });
  return (
    transaction && {
      ...transaction,
      amount: transaction.amount.toFixed(2),
      date: transaction.date.toISOString().slice(0, 10),
    }
  );
}

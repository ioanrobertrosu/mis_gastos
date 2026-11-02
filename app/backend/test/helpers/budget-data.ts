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

/** Crea una meta directamente en la BD de test. */
export async function seedGoal(
  budgetId: string,
  data: {
    title?: string;
    targetAmount?: string;
    currentAmount?: string;
    status?: 'IN_PROGRESS' | 'REACHED' | 'ARCHIVED';
    createdAt?: Date;
  } = {},
): Promise<string> {
  const goal = await testPrisma.goal.create({
    data: { budgetId, title: 'Vacaciones', targetAmount: '1000.00', ...data },
  });
  return goal.id;
}

/** La meta tal y como está en la BD, con importes como texto. */
export async function storedGoal(goalId: string) {
  const goal = await testPrisma.goal.findUnique({ where: { id: goalId } });
  return (
    goal && {
      ...goal,
      targetAmount: goal.targetAmount.toFixed(2),
      currentAmount: goal.currentAmount.toFixed(2),
      deadline: goal.deadline?.toISOString().slice(0, 10) ?? null,
    }
  );
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

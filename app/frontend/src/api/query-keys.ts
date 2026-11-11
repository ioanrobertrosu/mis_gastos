/** Filtros de la lista de transacciones (los de `GET /budgets/:id/transactions`). */
export interface TransactionFilters {
  categoryId?: string;
  from?: string;
  to?: string;
  isRecurring?: boolean;
}

/**
 * Claves de TanStack Query, jerárquicas: todo lo de un presupuesto cuelga de
 * `['budgets', id]`, así que invalidar ese prefijo refresca el presupuesto entero, y cada lista sin
 * filtros es el prefijo de sus variantes filtradas. Los filtros van como objeto: TanStack Query
 * compara las claves sin importar el orden de sus propiedades.
 */
export const queryKeys = {
  me: () => ['me'] as const,
  budgets: {
    all: () => ['budgets'] as const,
    detail: (budgetId: string) => ['budgets', budgetId] as const,
    /** Sin mes: el prefijo de los resúmenes de todos los meses. */
    summary: (budgetId: string, month?: string) =>
      month
        ? (['budgets', budgetId, 'summary', month] as const)
        : (['budgets', budgetId, 'summary'] as const),
    categories: (budgetId: string, params?: { month?: string; includeInactive?: boolean }) =>
      params
        ? (['budgets', budgetId, 'categories', params] as const)
        : (['budgets', budgetId, 'categories'] as const),
    transactions: (budgetId: string, filters?: TransactionFilters) =>
      filters
        ? (['budgets', budgetId, 'transactions', filters] as const)
        : (['budgets', budgetId, 'transactions'] as const),
    goals: (budgetId: string) => ['budgets', budgetId, 'goals'] as const,
    goal: (budgetId: string, goalId: string) => ['budgets', budgetId, 'goals', goalId] as const,
    contributions: (budgetId: string, goalId: string) =>
      ['budgets', budgetId, 'goals', goalId, 'contributions'] as const,
    members: (budgetId: string) => ['budgets', budgetId, 'members'] as const,
    activity: (budgetId: string) => ['budgets', budgetId, 'activity'] as const,
  },
};

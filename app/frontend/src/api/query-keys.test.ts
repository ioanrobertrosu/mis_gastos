import { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/api/query-keys';

const A = 'budget-a';
const B = 'budget-b';

/** Siembra la caché y devuelve qué consultas quedan invalidadas tras `invalidate`. */
async function invalidated(prefix: readonly unknown[], keys: readonly (readonly unknown[])[]) {
  const client = new QueryClient();
  for (const key of keys) client.setQueryData(key, 'dato');
  await client.invalidateQueries({ queryKey: prefix, refetchType: 'none' });
  const result = keys.filter((key) => client.getQueryState(key)?.isInvalidated);
  // Cada consulta en caché deja un temporizador de recolección: sin vaciar, Jest no termina limpio.
  client.clear();
  return result;
}

const budgetA = [
  queryKeys.budgets.detail(A),
  queryKeys.budgets.summary(A, '2026-11'),
  queryKeys.budgets.categories(A, { month: '2026-11' }),
  queryKeys.budgets.transactions(A, { categoryId: 'c1' }),
  queryKeys.budgets.goals(A),
  queryKeys.budgets.goal(A, 'g1'),
  queryKeys.budgets.contributions(A, 'g1'),
  queryKeys.budgets.members(A),
  queryKeys.budgets.activity(A),
];
const budgetB = [queryKeys.budgets.detail(B), queryKeys.budgets.transactions(B)];

describe('queryKeys', () => {
  it('invalidar un presupuesto refresca todo lo suyo y nada de otros presupuestos ni de /me', async () => {
    const result = await invalidated(queryKeys.budgets.detail(A), [
      ...budgetA,
      ...budgetB,
      queryKeys.me(),
    ]);

    expect(result).toEqual(budgetA);
  });

  it('la lista de presupuestos (budgets.all) cubre todos los presupuestos, pero no /me', async () => {
    const result = await invalidated(queryKeys.budgets.all(), [
      ...budgetA,
      ...budgetB,
      queryKeys.me(),
    ]);

    expect(result).toEqual([...budgetA, ...budgetB]);
  });

  it('transactions(id) sin filtros es el prefijo de todas sus listas filtradas', async () => {
    const lists = [
      queryKeys.budgets.transactions(A),
      queryKeys.budgets.transactions(A, { categoryId: 'c1' }),
      queryKeys.budgets.transactions(A, { from: '2026-11-01', isRecurring: true }),
    ];

    const result = await invalidated(queryKeys.budgets.transactions(A), [
      ...lists,
      queryKeys.budgets.summary(A, '2026-11'),
    ]);

    expect(result).toEqual(lists);
  });

  it('invalidar las metas incluye cada meta y sus contribuciones', async () => {
    const goals = [
      queryKeys.budgets.goals(A),
      queryKeys.budgets.goal(A, 'g1'),
      queryKeys.budgets.contributions(A, 'g1'),
    ];

    const result = await invalidated(queryKeys.budgets.goals(A), [
      ...goals,
      queryKeys.budgets.members(A),
    ]);

    expect(result).toEqual(goals);
  });

  it('los mismos filtros dan la misma clave (aunque cambie el orden) y otros filtros, otra', () => {
    const client = new QueryClient();
    client.setQueryData(
      queryKeys.budgets.transactions(A, { categoryId: 'c1', isRecurring: true }),
      1,
    );

    expect(
      client.getQueryData(
        queryKeys.budgets.transactions(A, { isRecurring: true, categoryId: 'c1' }),
      ),
    ).toBe(1);
    expect(
      client.getQueryData(queryKeys.budgets.transactions(A, { categoryId: 'c2' })),
    ).toBeUndefined();
    client.clear();
  });
});

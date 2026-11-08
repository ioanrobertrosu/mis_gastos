import type { PrismaClient } from '../../generated/prisma/client.js';
import { formatDate, parseDate } from '../../shared/date.js';
import { formatMoney } from '../../shared/money.js';
import { csvRow, textCell } from './csv.js';

// Cada lote es un viaje de ida y vuelta a la BD; 1000 filas son unos 100 KB de CSV.
const BATCH_SIZE = 1000;
// BOM: sin él, Excel interpreta el UTF-8 como ANSI y estropea los acentos.
const BOM = '﻿';
const HEADER = ['fecha', 'categoria', 'importe', 'descripcion', 'recurrente', 'autor'];

/**
 * Genera el CSV por lotes (paginación keyset en orden `date ASC, id ASC`) para no cargar en
 * memoria todo el histórico. Importes, fechas y `sí/no` los genera la app: solo el texto libre
 * necesita protección contra fórmulas.
 */
export async function* exportTransactionsCsv(
  prisma: PrismaClient,
  budgetId: string,
  { from, to }: { from: string; to: string },
): AsyncGenerator<string> {
  yield BOM + csvRow(HEADER);

  // Nombres de categorías y autores, una sola vez y no por lote. Los autores que ya no son
  // miembros (expulsados, cuentas borradas) se buscan solo cuando aparecen.
  const [categories, members] = await Promise.all([
    prisma.category.findMany({ where: { budgetId }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { memberships: { some: { budgetId } } }, select: AUTHOR }),
  ]);
  const categoryNames = new Map(categories.map(({ id, name }) => [id, name]));
  const authorNames = new Map(members.map((user) => [user.id, authorName(user)]));

  let after: { date: Date; id: string } | undefined;
  for (;;) {
    const rows = await prisma.transaction.findMany({
      where: {
        budgetId,
        // `gte` desde el cursor: el `OR` no acota el índice y cada lote costaría más que el anterior.
        date: { gte: after?.date ?? parseDate(from), lte: parseDate(to) },
        ...(after
          ? { OR: [{ date: { gt: after.date } }, { date: after.date, id: { gt: after.id } }] }
          : {}),
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: BATCH_SIZE,
      select: {
        id: true,
        date: true,
        amount: true,
        description: true,
        isRecurring: true,
        categoryId: true,
        createdById: true,
      },
    });

    const last = rows.at(-1);
    if (!last) return;

    const unknown = new Set(
      rows.flatMap(({ createdById: id }) => (id === null || authorNames.has(id) ? [] : [id])),
    );
    if (unknown.size > 0) {
      const authors = await prisma.user.findMany({
        where: { id: { in: [...unknown] } },
        select: AUTHOR,
      });
      for (const user of authors) authorNames.set(user.id, authorName(user));
    }

    yield rows
      .map((row) =>
        csvRow([
          formatDate(row.date),
          textCell(categoryNames.get(row.categoryId) ?? ''),
          formatMoney(row.amount),
          textCell(row.description),
          row.isRecurring ? 'sí' : 'no',
          textCell(row.createdById === null ? null : (authorNames.get(row.createdById) ?? null)),
        ]),
      )
      .join('');

    if (rows.length < BATCH_SIZE) return;
    after = { date: last.date, id: last.id };
  }
}

const AUTHOR = { id: true, displayName: true, email: true } as const;

function authorName({ displayName, email }: { displayName: string | null; email: string }) {
  return displayName ?? email;
}

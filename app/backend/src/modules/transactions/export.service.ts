import type { PrismaClient } from '../../generated/prisma/client.js';
import { formatDate, parseDate } from '../../shared/date.js';
import { formatMoney } from '../../shared/money.js';
import { csvRow, textCell } from './csv.js';

const BATCH_SIZE = 500;
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
        category: { select: { name: true } },
        createdBy: { select: { displayName: true, email: true } },
      },
    });

    const last = rows.at(-1);
    if (!last) return;

    yield rows
      .map((row) =>
        csvRow([
          formatDate(row.date),
          textCell(row.category.name),
          formatMoney(row.amount),
          textCell(row.description),
          row.isRecurring ? 'sí' : 'no',
          textCell(row.createdBy && (row.createdBy.displayName ?? row.createdBy.email)),
        ]),
      )
      .join('');

    if (rows.length < BATCH_SIZE) return;
    after = { date: last.date, id: last.id };
  }
}

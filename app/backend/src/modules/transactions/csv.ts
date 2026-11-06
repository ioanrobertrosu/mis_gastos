const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * Celda de texto libre (descripciones, nombres): la protege contra la inyección de fórmulas
 * (una hoja de cálculo ejecutaría `=...`) con un `'` delante y luego la escapa como cualquiera.
 */
export function textCell(value: string | null): string {
  if (value === null) return '';
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function escapeCell(cell: string): string {
  return NEEDS_QUOTES.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/** Fila CSV según la RFC 4180: separada por comas y terminada en CRLF. */
export function csvRow(cells: string[]): string {
  return `${cells.map(escapeCell).join(',')}\r\n`;
}

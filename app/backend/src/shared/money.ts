import { Type } from '@fastify/type-provider-typebox';
import { Prisma } from '../generated/prisma/client.js';

/**
 * Importe monetario como texto (`"250"`, `"250.5"`, `"250.50"`): no negativo, hasta 10 cifras
 * enteras y 2 decimales, como `Decimal(12, 2)`. Se rechazan los números JSON para no pasar nunca
 * por coma flotante.
 */
export const MoneySchema = Type.String({ pattern: String.raw`^\d{1,10}(\.\d{1,2})?$` });

/** Como `MoneySchema`, pero mayor que cero (`"0"`, `"0.00"` no valen). */
export const PositiveMoneySchema = Type.String({
  pattern: String.raw`^(?!0+(\.0{1,2})?$)\d{1,10}(\.\d{1,2})?$`,
});

/** Formato de salida de un importe: siempre con 2 decimales. */
export function formatMoney(amount: { toFixed(digits: number): string }): string {
  return amount.toFixed(2);
}

/**
 * `part / total` en %, calculado en decimal exacto y redondeado a 1 decimal (mitad hacia
 * arriba). `null` si el total es 0. Puede superar 100.
 */
export function percentOf(part: Prisma.Decimal, total: Prisma.Decimal): number | null {
  if (total.isZero()) return null;
  return part.div(total).mul(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

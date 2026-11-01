import { Type } from '@fastify/type-provider-typebox';

/**
 * Importe monetario como texto (`"250"`, `"250.5"`, `"250.50"`): no negativo, hasta 10 cifras
 * enteras y 2 decimales, como `Decimal(12, 2)`. Se rechazan los números JSON para no pasar nunca
 * por coma flotante.
 */
export const MoneySchema = Type.String({ pattern: String.raw`^\d{1,10}(\.\d{1,2})?$` });

/** Formato de salida de un importe: siempre con 2 decimales. */
export function formatMoney(amount: { toFixed(digits: number): string }): string {
  return amount.toFixed(2);
}

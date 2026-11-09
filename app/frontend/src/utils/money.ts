// Formato de los importes de la API: decimal positivo con hasta dos decimales ("12.50").
const API_AMOUNT = /^\d+(?:\.\d{1,2})?$/;

/** Importe de la API en céntimos exactos, sin pasar por coma flotante. */
export function toCents(amount: string): bigint {
  if (!API_AMOUNT.test(amount)) {
    throw new Error(`Importe no válido: ${JSON.stringify(amount)}`);
  }
  const [units = '0', decimals = ''] = amount.split('.');
  return BigInt(units) * 100n + BigInt(decimals.padEnd(2, '0'));
}

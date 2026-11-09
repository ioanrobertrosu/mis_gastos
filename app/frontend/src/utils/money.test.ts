import { toCents } from '@/utils/money';

describe('toCents', () => {
  it.each([
    ['0', 0n],
    ['0.00', 0n],
    ['12.5', 1250n],
    ['12.50', 1250n],
    ['1000000.99', 100000099n],
  ])('convierte el importe de la API %s en %s céntimos exactos', (amount, cents) => {
    expect(toCents(amount)).toBe(cents);
  });

  it.each(['', 'abc', '1.234', '-1.00', '1,50', ' 1.00', '1e3'])(
    'rechaza %j: no es un importe de la API',
    (amount) => {
      expect(() => toCents(amount)).toThrow(`Importe no válido: ${JSON.stringify(amount)}`);
    },
  );
});

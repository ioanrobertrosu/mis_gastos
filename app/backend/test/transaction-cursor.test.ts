import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../src/modules/transactions/cursor.js';

const KEY = { date: '2026-10-15', id: '123e4567-e89b-42d3-a456-426614174000' };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('cursor de transacciones', () => {
  it('decodifica lo que codifica', () => {
    expect(decodeCursor(encodeCursor(KEY))).toEqual(KEY);
  });

  it.each([
    ['JSON que no es un array', encode({ date: KEY.date, id: KEY.id })],
    ['array de otra longitud', encode([KEY.date])],
    ['fecha con otro formato', encode(['15/10/2026', KEY.id])],
    ['id que no es UUID', encode([KEY.date, '1; DROP TABLE'])],
    ['tipos incorrectos', encode([20261015, KEY.id])],
    ['texto que no es JSON', Buffer.from('hola').toString('base64url')],
  ])('rechaza con VALIDATION_ERROR: %s', (_case, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR' }),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { decodeActivityCursor, encodeActivityCursor } from '../src/modules/activity/cursor.js';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('cursor del muro de actividad', () => {
  it('decodifica lo que codifica', () => {
    expect(decodeActivityCursor(encodeActivityCursor(42))).toBe(42);
  });

  it.each([
    ['JSON que no es un array', encode({ seq: 1 })],
    ['array de otra longitud', encode([1, 2])],
    ['seq no entero', encode([1.5])],
    ['seq no positivo', encode([0])],
    ['seq como texto', encode(['1'])],
    ['texto que no es JSON', Buffer.from('hola').toString('base64url')],
  ])('rechaza con VALIDATION_ERROR: %s', (_case, cursor) => {
    expect(() => decodeActivityCursor(cursor)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR' }),
    );
  });
});

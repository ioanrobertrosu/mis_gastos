import { ApiError } from '@/api/client';
import { createQueryClient, shouldRetry } from '@/api/query-client';

const apiError = (status: number) => new ApiError(status, 'X', 'x', null);

describe('createQueryClient', () => {
  it.each([
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [409, false],
    [429, false], // reintentar un límite de peticiones lo empeora
    [500, true],
    [502, true],
    [0, true], // sin conexión
  ])('un ApiError %i se reintenta: %s', (status, retries) => {
    expect(shouldRetry(0, apiError(status))).toBe(retries);
  });

  it('reintenta como mucho 2 veces', () => {
    expect(shouldRetry(1, apiError(503))).toBe(true);
    expect(shouldRetry(2, apiError(503))).toBe(false);
  });

  it('un error que no es de la API (un fallo del código) no se reintenta', () => {
    expect(shouldRetry(0, new TypeError('x is undefined'))).toBe(false);
  });

  it('las consultas usan shouldRetry y 30 s de staleTime; las mutaciones nunca se reintentan', () => {
    const { queries, mutations } = createQueryClient().getDefaultOptions();

    expect(queries?.retry).toBe(shouldRetry);
    expect(queries?.staleTime).toBe(30_000);
    expect(mutations?.retry).toBe(false);
  });
});

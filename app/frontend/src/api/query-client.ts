import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/client';

const MAX_RETRIES = 2;

/**
 * Solo se reintenta lo que puede salir bien a la segunda: sin conexión (estado 0) o un 5xx. Un 4xx
 * volvería a fallar (y un 429 empeoraría el límite); un error que no es de la API es un fallo del
 * código.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES || !(error instanceof ApiError)) return false;
  return error.status === 0 || error.status >= 500;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // Lo fresco lo garantiza el WebSocket (invalida al recibir cambios); esto evita repetir
      // consultas al navegar entre pantallas.
      queries: { retry: shouldRetry, staleTime: 30_000 },
      // Una mutación repetida podría aplicarse dos veces (p. ej. una aportación).
      mutations: { retry: false },
    },
  });
}

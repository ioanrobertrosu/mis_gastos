/**
 * Opciones para transacciones interactivas que esperan bloqueos de fila (`FOR UPDATE`).
 * Los valores por defecto de Prisma (maxWait 2 s, timeout 5 s) se quedan cortos cuando varias
 * peticiones simultáneas hacen cola sobre la misma fila: la última abortaría con un 500.
 */
export const LOCKING_TRANSACTION = { maxWait: 10_000, timeout: 15_000 } as const;

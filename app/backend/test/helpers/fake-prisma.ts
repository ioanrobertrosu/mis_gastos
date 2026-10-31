import { vi } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Cliente Prisma falso para tests unitarios: `$queryRaw` configurable y modelos cuyas
 * escrituras resuelven sin hacer nada (la autenticación sincroniza el usuario en cada petición).
 */
export function fakePrisma(
  queryRaw: () => Promise<unknown> = async () => [{ '?column?': 1 }],
): PrismaClient {
  const model = () => ({
    upsert: vi.fn(async () => ({})),
    createMany: vi.fn(async () => ({ count: 1 })),
    findUnique: vi.fn(async () => null),
  });
  const fake: Record<string, unknown> = {
    $queryRaw: vi.fn(queryRaw),
    $disconnect: vi.fn(),
    user: model(),
    identity: model(),
  };
  fake.$transaction = vi.fn(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(fake),
  );
  return fake as unknown as PrismaClient;
}

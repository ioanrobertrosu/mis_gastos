import { vi } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

export function fakePrisma(
  queryRaw: () => Promise<unknown> = async () => [{ '?column?': 1 }],
): PrismaClient {
  return { $queryRaw: vi.fn(queryRaw), $disconnect: vi.fn() } as unknown as PrismaClient;
}

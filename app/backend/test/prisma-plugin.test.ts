import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { fakePrisma } from './helpers/fake-prisma.js';
import { TEST_AUTH } from './helpers/jwt.js';

describe('plugin de Prisma', () => {
  it('expone el cliente como app.prisma y lo desconecta al cerrar la app', async () => {
    const prisma = fakePrisma();
    const app = await buildApp({ auth: TEST_AUTH, prisma });
    await app.ready();

    expect(app.prisma).toBe(prisma);

    await app.close();

    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });
});

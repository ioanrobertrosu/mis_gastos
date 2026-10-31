import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testPrisma } from '../helpers/db.js';

const USER = { id: '123e4567-e89b-42d3-a456-426614174000', email: 'ana@example.com' };

describe('BD de test', () => {
  it('/health informa db "up" contra la BD real de test', async () => {
    const app = await buildApp({ prisma: testPrisma });
    // La conexión compartida no debe cerrarse al cerrar la app del test.
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.json()).toEqual({ status: 'ok', db: 'up' });
  });

  it('permite escribir y leer datos', async () => {
    await testPrisma.user.create({ data: USER });

    await expect(testPrisma.user.count()).resolves.toBe(1);
  });

  it('empieza cada test con la BD vacía (el usuario anterior no existe)', async () => {
    await expect(testPrisma.user.count()).resolves.toBe(0);
    // Mismo email @unique que el test anterior: fallaría si no se hubiera limpiado.
    await expect(testPrisma.user.create({ data: USER })).resolves.toMatchObject(USER);
  });
});

import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AuthAdmin } from '../../src/modules/users/auth-admin.js';
import {
  seedCategory,
  seedGoal,
  seedTransaction,
  storedGoal,
  storedTransaction,
} from '../helpers/budget-data.js';
import { testPrisma } from '../helpers/db.js';
import { signTestToken, TEST_AUTH } from '../helpers/jwt.js';
import { ANA, authHeader, BEA, CARLOS, DANI, seedBudget, type TestUser } from '../helpers/users.js';

let app: FastifyInstance;
let authAdmin: { deleteUser: ReturnType<typeof vi.fn<AuthAdmin['deleteUser']>> };

beforeEach(async () => {
  authAdmin = { deleteUser: vi.fn<AuthAdmin['deleteUser']>(async () => {}) };
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma, authAdmin });
});

async function deleteAccount(user: TestUser) {
  return app.inject({ method: 'DELETE', url: '/api/v1/me', headers: await authHeader(user) });
}

async function getMe(user: TestUser) {
  return app.inject({ method: 'GET', url: '/api/v1/me', headers: await authHeader(user) });
}

async function roles(budgetId: string) {
  const members = await testPrisma.budgetMember.findMany({
    where: { budgetId },
    select: { userId: true, role: true },
  });
  return Object.fromEntries(members.map(({ userId, role }) => [userId, role]));
}

describe('DELETE /api/v1/me', () => {
  it('sin token devuelve 401', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/api/v1/me' });

    expect(response.statusCode).toBe(401);
  });

  describe('fallback de propiedad', () => {
    it('el OWNER pasa al miembro con joinedAt más antiguo, no al de rol más alto', async () => {
      // CARLOS (VIEWER) entró antes que BEA (EDITOR).
      const id = await seedBudget([
        { user: ANA, role: 'OWNER' },
        { user: CARLOS, role: 'VIEWER' },
        { user: BEA, role: 'EDITOR' },
      ]);

      const response = await deleteAccount(ANA);

      expect(response.statusCode).toBe(204);
      await expect(roles(id)).resolves.toEqual({ [CARLOS.sub]: 'OWNER', [BEA.sub]: 'EDITOR' });
    });

    it('siendo el único miembro, el presupuesto se elimina en cascada', async () => {
      const id = await seedBudget([{ user: ANA, role: 'OWNER' }]);
      await testPrisma.oneTimeInvite.create({
        data: { budgetId: id, createdById: ANA.sub, expiresAt: new Date(Date.now() + 3_600_000) },
      });

      expect((await deleteAccount(ANA)).statusCode).toBe(204);

      await expect(testPrisma.budget.count({ where: { id } })).resolves.toBe(0);
      await expect(testPrisma.oneTimeInvite.count({ where: { budgetId: id } })).resolves.toBe(0);
    });

    it('como miembro no OWNER solo sale del presupuesto', async () => {
      const id = await seedBudget([
        { user: BEA, role: 'OWNER' },
        { user: ANA, role: 'EDITOR' },
      ]);

      expect((await deleteAccount(ANA)).statusCode).toBe(204);

      await expect(roles(id)).resolves.toEqual({ [BEA.sub]: 'OWNER' });
    });

    it('resuelve cada presupuesto del usuario en la misma operación', async () => {
      const shared = await seedBudget([
        { user: ANA, role: 'OWNER' },
        { user: DANI, role: 'LIMITED_EDITOR' },
      ]);
      const alone = await seedBudget([{ user: ANA, role: 'OWNER' }]);
      const foreign = await seedBudget([
        { user: BEA, role: 'OWNER' },
        { user: ANA, role: 'VIEWER' },
      ]);

      expect((await deleteAccount(ANA)).statusCode).toBe(204);

      await expect(roles(shared)).resolves.toEqual({ [DANI.sub]: 'OWNER' });
      await expect(testPrisma.budget.count({ where: { id: alone } })).resolves.toBe(0);
      await expect(roles(foreign)).resolves.toEqual({ [BEA.sub]: 'OWNER' });
      await expect(testPrisma.budgetMember.count({ where: { userId: ANA.sub } })).resolves.toBe(0);
    });
  });

  describe('soft delete y anonimización', () => {
    it('conserva la fila del usuario anonimizada y sin identidades', async () => {
      await getMe(ANA); // Registra a ANA con su identidad.
      await testPrisma.user.update({
        where: { id: ANA.sub },
        data: { displayName: 'Ana García', avatarUrl: 'https://cdn.example.com/ana.png' },
      });

      expect((await deleteAccount(ANA)).statusCode).toBe(204);

      const user = await testPrisma.user.findUnique({ where: { id: ANA.sub } });
      expect(user).toMatchObject({
        displayName: 'Usuario Eliminado',
        avatarUrl: null,
        deletedAt: expect.any(Date),
      });
      expect(user?.email).not.toContain(ANA.email);
      await expect(testPrisma.identity.count({ where: { userId: ANA.sub } })).resolves.toBe(0);
    });

    it('el token de la cuenta borrada deja de ser válido y no la resucita', async () => {
      await getMe(ANA);
      await deleteAccount(ANA);

      const response = await getMe(ANA);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
      await expect(testPrisma.identity.count({ where: { userId: ANA.sub } })).resolves.toBe(0);
      await expect(testPrisma.user.findUnique({ where: { id: ANA.sub } })).resolves.toMatchObject({
        displayName: 'Usuario Eliminado',
      });
    });

    it('borrar la cuenta dos veces devuelve 401 la segunda', async () => {
      await deleteAccount(ANA);

      expect((await deleteAccount(ANA)).statusCode).toBe(401);
    });

    it('el email y la identidad del proveedor quedan libres para una cuenta nueva', async () => {
      await getMe(ANA);
      await deleteAccount(ANA);

      // Nueva cuenta de Supabase (otro sub) con el mismo email y la misma cuenta de Google.
      const token = await signTestToken({
        sub: '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d',
        email: ANA.email,
        userMetadata: { provider_id: `google-${ANA.sub}` },
      });
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d',
        email: ANA.email,
        displayName: null,
      });
    });
  });

  describe('integridad de los movimientos', () => {
    it('las transacciones del usuario borrado se conservan con su autor anonimizado', async () => {
      const shared = await seedBudget([
        { user: ANA, role: 'OWNER' },
        { user: BEA, role: 'EDITOR' },
      ]);
      const categoryId = await seedCategory(shared);
      const id = await seedTransaction(shared, categoryId, { createdBy: ANA, amount: '42.10' });

      expect((await deleteAccount(ANA)).statusCode).toBe(204);

      await expect(storedTransaction(id)).resolves.toMatchObject({
        amount: '42.10',
        createdById: ANA.sub,
      });
      await expect(
        testPrisma.user.findUnique({ where: { id: ANA.sub }, select: { displayName: true } }),
      ).resolves.toEqual({ displayName: 'Usuario Eliminado' });
    });

    it('las contribuciones a metas se conservan y la meta no se descuadra', async () => {
      const shared = await seedBudget([
        { user: ANA, role: 'OWNER' },
        { user: BEA, role: 'EDITOR' },
      ]);
      const goal = await seedGoal(shared, { currentAmount: '75.50' });
      await testPrisma.goalContribution.create({
        data: { goalId: goal, userId: ANA.sub, amount: '75.50' },
      });

      expect((await deleteAccount(ANA)).statusCode).toBe(204);

      await expect(
        testPrisma.goalContribution.findMany({
          where: { goalId: goal },
          select: { userId: true, amount: true },
        }),
      ).resolves.toEqual([{ userId: ANA.sub, amount: expect.anything() }]);
      await expect(storedGoal(goal)).resolves.toMatchObject({ currentAmount: '75.50' });
    });

    it('las transacciones de un presupuesto borrado en cascada desaparecen con él', async () => {
      const alone = await seedBudget([{ user: ANA, role: 'OWNER' }]);
      const id = await seedTransaction(alone, await seedCategory(alone), { createdBy: ANA });

      expect((await deleteAccount(ANA)).statusCode).toBe(204);

      await expect(storedTransaction(id)).resolves.toBeNull();
    });
  });

  describe('Supabase Auth', () => {
    it('borra también el usuario en Supabase Auth', async () => {
      expect((await deleteAccount(ANA)).statusCode).toBe(204);

      expect(authAdmin.deleteUser).toHaveBeenCalledOnce();
      expect(authAdmin.deleteUser).toHaveBeenCalledWith(ANA.sub);
    });

    it('lo hace después de confirmar el borrado local', async () => {
      authAdmin.deleteUser.mockImplementationOnce(async (userId) => {
        const user = await testPrisma.user.findUnique({ where: { id: userId } });
        expect(user?.deletedAt).toBeInstanceOf(Date);
      });

      expect((await deleteAccount(ANA)).statusCode).toBe(204);
      expect(authAdmin.deleteUser).toHaveBeenCalledOnce();
    });

    it('si Supabase falla, el borrado local se mantiene y la respuesta sigue siendo 204', async () => {
      authAdmin.deleteUser.mockRejectedValueOnce(new Error('Supabase Auth respondió 500'));
      await seedBudget([{ user: ANA, role: 'OWNER' }]);

      const response = await deleteAccount(ANA);

      expect(response.statusCode).toBe(204);
      expect(authAdmin.deleteUser).toHaveBeenCalledOnce();
      await expect(testPrisma.user.findUnique({ where: { id: ANA.sub } })).resolves.toMatchObject({
        displayName: 'Usuario Eliminado',
      });
      await expect(testPrisma.budgetMember.count({ where: { userId: ANA.sub } })).resolves.toBe(0);
    });

    it('una cuenta ya borrada (401) no vuelve a llamar a Supabase', async () => {
      await deleteAccount(ANA);
      await deleteAccount(ANA);

      expect(authAdmin.deleteUser).toHaveBeenCalledOnce();
    });
  });
});

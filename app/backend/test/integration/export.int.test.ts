import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { exportTransactionsCsv } from '../../src/modules/transactions/export.service.js';
import { seedCategory, seedTransaction } from '../helpers/budget-data.js';
import { testPrisma } from '../helpers/db.js';
import { TEST_AUTH } from '../helpers/jwt.js';
import { QueryCounter } from '../helpers/query-count.js';
import { ANA, authHeader, BEA, CARLOS, seedBudget, type TestUser } from '../helpers/users.js';

const BOM = '﻿';
const HEADER = 'fecha,categoria,importe,descripcion,recurrente,autor';
const RANGE = 'from=2026-10-01&to=2026-10-31';

let app: FastifyInstance;

beforeEach(async () => {
  // No se cierra la app: cerrarla desconectaría el cliente compartido de la BD de test.
  app = await buildApp({ auth: TEST_AUTH, prisma: testPrisma });
});

async function exportCsv(user: TestUser, budgetId: string, query = RANGE) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/budgets/${budgetId}/export${query ? `?${query}` : ''}`,
    headers: await authHeader(user),
  });
}

/** Filas del CSV sin BOM ni cabecera. */
async function rows(user: TestUser, budgetId: string, query = RANGE) {
  const response = await exportCsv(user, budgetId, query);
  expect(response.statusCode).toBe(200);
  return response.body.slice(BOM.length).split('\r\n').slice(1, -1);
}

/** ANA (OWNER) y CARLOS (VIEWER), con una categoría «Comida». */
async function budget() {
  const budgetId = await seedBudget([
    { user: ANA, role: 'OWNER' },
    { user: CARLOS, role: 'VIEWER' },
  ]);
  return { budgetId, categoryId: await seedCategory(budgetId, { name: 'Comida' }) };
}

describe('GET /api/v1/budgets/:id/export', () => {
  describe('formato', () => {
    it('devuelve text/csv descargable, con BOM, cabecera y filas en orden cronológico', async () => {
      const { budgetId, categoryId } = await budget();
      await testPrisma.user.update({ where: { id: ANA.sub }, data: { displayName: 'Ana' } });
      await seedTransaction(budgetId, categoryId, {
        createdBy: ANA,
        amount: '20',
        date: '2026-10-20',
      });
      const first = await seedTransaction(budgetId, categoryId, {
        createdBy: ANA,
        amount: '12.5',
        date: '2026-10-05',
        description: 'Mercadona',
      });
      await testPrisma.transaction.update({ where: { id: first }, data: { isRecurring: true } });

      const response = await exportCsv(CARLOS, budgetId);

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="gastos_2026-10-01_2026-10-31.csv"',
      );
      expect(response.body).toBe(
        `${BOM}${HEADER}\r\n` +
          '2026-10-05,Comida,12.50,Mercadona,sí,Ana\r\n' +
          '2026-10-20,Comida,20.00,,no,Ana\r\n',
      );
    });

    it('sin transacciones en el rango devuelve solo la cabecera', async () => {
      const { budgetId } = await budget();

      const response = await exportCsv(ANA, budgetId);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(`${BOM}${HEADER}\r\n`);
    });

    it('incluye ambos extremos del rango y nada fuera de él ni de otros presupuestos', async () => {
      const { budgetId, categoryId } = await budget();
      for (const date of ['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01']) {
        await seedTransaction(budgetId, categoryId, { date });
      }
      const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
      await seedTransaction(other, await seedCategory(other), { date: '2026-10-15' });

      const result = await rows(ANA, budgetId);

      expect(result.map((row) => row.slice(0, 10))).toEqual(['2026-10-01', '2026-10-31']);
    });

    it('incluye el gasto de categorías desactivadas', async () => {
      const { budgetId } = await budget();
      const antigua = await seedCategory(budgetId, { name: 'Antigua', isActive: false });
      await seedTransaction(budgetId, antigua, { date: '2026-10-10' });

      const result = await rows(ANA, budgetId);

      expect(result).toEqual(['2026-10-10,Antigua,10.00,,no,']);
    });

    it('autor: nombre, si no el email; cuenta borrada anonimizada; sin autor, vacío', async () => {
      const { budgetId, categoryId } = await budget();
      await testPrisma.user.update({ where: { id: ANA.sub }, data: { displayName: 'Ana' } });
      await seedTransaction(budgetId, categoryId, { createdBy: ANA, date: '2026-10-01' });
      await seedTransaction(budgetId, categoryId, { createdBy: CARLOS, date: '2026-10-02' });
      await seedBudget([{ user: BEA, role: 'OWNER' }]);
      await seedTransaction(budgetId, categoryId, { createdBy: BEA, date: '2026-10-03' });
      await testPrisma.user.update({
        where: { id: BEA.sub },
        data: { displayName: 'Usuario Eliminado', deletedAt: new Date() },
      });
      await seedTransaction(budgetId, categoryId, { date: '2026-10-04' });

      const result = await rows(ANA, budgetId);

      expect(result.map((row) => row.split(',').at(-1))).toEqual([
        'Ana',
        CARLOS.email,
        'Usuario Eliminado',
        '',
      ]);
    });

    it('un export mayor que un lote incluye todas las filas una sola vez y en orden', async () => {
      const { budgetId, categoryId } = await budget();
      await testPrisma.transaction.createMany({
        data: Array.from({ length: 1205 }, (_, i) => ({
          budgetId,
          categoryId,
          amount: '1.00',
          description: `gasto-${i}`,
          date: new Date(`2026-10-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`),
        })),
      });

      const result = await rows(ANA, budgetId);

      const dates = result.map((row) => row.slice(0, 10));
      expect(result).toHaveLength(1205);
      expect(new Set(result).size).toBe(1205);
      expect(dates).toEqual([...dates].sort());
    }, 30_000);
  });

  describe('consultas', () => {
    // En producción cada consulta es un viaje de ida y vuelta a la BD (~30 ms).
    it('una consulta por lote de 1000 filas; categorías y autores, una sola vez', async () => {
      const { budgetId, categoryId } = await budget();
      const other = await seedCategory(budgetId, { name: 'Ocio' });
      await testPrisma.user.update({ where: { id: CARLOS.sub }, data: { displayName: 'Carlos' } });
      await testPrisma.transaction.createMany({
        data: Array.from({ length: 2499 }, (_, i) => ({
          budgetId,
          categoryId: i % 2 === 0 ? categoryId : other,
          createdById: ANA.sub,
          amount: '1.00',
          date: new Date(`2026-10-${String((i % 30) + 1).padStart(2, '0')}T00:00:00.000Z`),
        })),
      });
      // Única fila del último lote, con un autor que no aparece en los anteriores.
      await seedTransaction(budgetId, other, { createdBy: CARLOS, date: '2026-10-31' });
      const counter = new QueryCounter();

      let csv = '';
      for await (const chunk of exportTransactionsCsv(counter.prisma, budgetId, {
        from: '2026-10-01',
        to: '2026-10-31',
      })) {
        csv += chunk;
      }

      const lines = csv.split('\r\n').slice(1, -1);
      expect(lines).toHaveLength(2500);
      expect(lines.at(-1)).toBe('2026-10-31,Ocio,10.00,,no,Carlos');
      // 3 lotes (1000 + 1000 + 500) + categorías + miembros del presupuesto.
      expect(counter.queries.length).toBeLessThanOrEqual(5);
    }, 30_000);
  });

  describe('escapado', () => {
    it.each([
      ['comas', 'pan, leche', '"pan, leche"'],
      ['comillas', 'el "bueno"', '"el ""bueno"""'],
      ['salto de línea', 'línea 1\nlínea 2', '"línea 1\nlínea 2"'],
      ['retorno de carro', 'línea 1\r\nlínea 2', '"línea 1\r\nlínea 2"'],
    ])('escapa %s', async (_case, description, expected) => {
      const { budgetId, categoryId } = await budget();
      await seedTransaction(budgetId, categoryId, { date: '2026-10-10', description });

      const response = await exportCsv(ANA, budgetId);

      expect(response.body).toBe(`${BOM}${HEADER}\r\n2026-10-10,Comida,10.00,${expected},no,\r\n`);
    });
  });

  describe('inyección de fórmulas', () => {
    it.each([
      ['=', '=SUM(A1:A9)', "'=SUM(A1:A9)"],
      ['+', '+34600000000', "'+34600000000"],
      ['-', '-2+3', "'-2+3"],
      ['@', '@SUM(A1)', "'@SUM(A1)"],
      ['tabulador', '\t=1+1', "'\t=1+1"],
      [
        'fórmula con comas',
        '=HYPERLINK("http://x.test","a")',
        `"'=HYPERLINK(""http://x.test"",""a"")"`,
      ],
    ])('neutraliza una descripción que empieza por %s', async (_case, description, expected) => {
      const { budgetId, categoryId } = await budget();
      await seedTransaction(budgetId, categoryId, { date: '2026-10-10', description });

      const response = await exportCsv(ANA, budgetId);

      expect(response.body).toBe(`${BOM}${HEADER}\r\n2026-10-10,Comida,10.00,${expected},no,\r\n`);
    });

    it('neutraliza también el nombre de la categoría y el del autor', async () => {
      const { budgetId } = await budget();
      const categoryId = await seedCategory(budgetId, { name: '=Categoria' });
      await testPrisma.user.update({ where: { id: ANA.sub }, data: { displayName: '@Ana' } });
      await seedTransaction(budgetId, categoryId, { createdBy: ANA, date: '2026-10-10' });

      const result = await rows(ANA, budgetId);

      expect(result).toEqual(["2026-10-10,'=Categoria,10.00,,no,'@Ana"]);
    });

    it('no toca el texto normal que contiene esos signos más adelante', async () => {
      const { budgetId, categoryId } = await budget();
      await seedTransaction(budgetId, categoryId, {
        date: '2026-10-10',
        description: 'Ana@casa = 2+2',
      });

      const result = await rows(ANA, budgetId);

      expect(result).toEqual(['2026-10-10,Comida,10.00,Ana@casa = 2+2,no,']);
    });
  });

  describe('acceso y validación', () => {
    it('más de 10 exportaciones por minuto devuelven 429', async () => {
      const { budgetId } = await budget();

      for (let i = 0; i < 10; i++) {
        expect((await exportCsv(ANA, budgetId)).statusCode).toBe(200);
      }
      const blocked = await exportCsv(ANA, budgetId);

      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    });

    it('un VIEWER puede exportar', async () => {
      const { budgetId } = await budget();

      const response = await exportCsv(CARLOS, budgetId);

      expect(response.statusCode).toBe(200);
    });

    it('un no miembro recibe 404 y ningún dato', async () => {
      const other = await seedBudget([{ user: BEA, role: 'OWNER' }]);
      await seedTransaction(other, await seedCategory(other), {
        date: '2026-10-10',
        description: 'secreto',
      });

      const response = await exportCsv(ANA, other);

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { message: 'Presupuesto no encontrado' } });
      expect(response.body).not.toContain('secreto');
    });

    it('sin token devuelve 401', async () => {
      const { budgetId } = await budget();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/budgets/${budgetId}/export?${RANGE}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it.each([
      ['sin rango', ''],
      ['sin from', 'to=2026-10-31'],
      ['sin to', 'from=2026-10-01'],
      ['fecha imposible', 'from=2026-02-30&to=2026-03-01'],
      ['otro formato', 'from=01/10/2026&to=31/10/2026'],
      ['from posterior a to', 'from=2026-10-31&to=2026-10-01'],
      ['parámetro desconocido', `${RANGE}&categoryId=abc`],
    ])('rechaza con 400: %s', async (_case, query) => {
      const { budgetId } = await budget();

      const response = await exportCsv(ANA, budgetId, query);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    });
  });
});

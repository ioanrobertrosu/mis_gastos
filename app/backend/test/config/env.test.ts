import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/mis_gastos';

describe('loadEnv', () => {
  it('falla de forma explícita si falta DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('trata una DATABASE_URL vacía como ausente', () => {
    expect(() => loadEnv({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('aplica valores por defecto a las variables opcionales', () => {
    expect(loadEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      DATABASE_URL,
      CORS_ORIGINS: [],
    });
  });

  it('convierte CORS_ORIGINS (separado por comas) en una lista sin espacios ni vacíos', () => {
    expect(
      loadEnv({ DATABASE_URL, CORS_ORIGINS: 'http://localhost:8081, https://app.example.com,' })
        .CORS_ORIGINS,
    ).toEqual(['http://localhost:8081', 'https://app.example.com']);
  });

  it('convierte PORT a número', () => {
    expect(loadEnv({ DATABASE_URL, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rechaza un PORT que no es un entero válido', () => {
    expect(() => loadEnv({ DATABASE_URL, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadEnv({ DATABASE_URL, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rechaza un NODE_ENV desconocido', () => {
    expect(() => loadEnv({ DATABASE_URL, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('ignora variables que no forman parte del esquema', () => {
    expect(loadEnv({ DATABASE_URL, PATH: '/usr/bin' })).not.toHaveProperty('PATH');
  });
});

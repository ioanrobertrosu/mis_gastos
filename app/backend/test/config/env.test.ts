import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/mis_gastos';
const SUPABASE_JWT_SECRET = 'secreto-de-test-con-al-menos-32-caracteres';
const JWT_ISSUER = 'https://test-project.supabase.co/auth/v1';
const SUPABASE_URL = 'https://test-project.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_clave-de-test';

/** Variables obligatorias mínimas para un entorno válido. */
const REQUIRED = {
  DATABASE_URL,
  SUPABASE_JWT_SECRET,
  JWT_ISSUER,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
};

function without(key: keyof typeof REQUIRED): Record<string, string> {
  const env: Record<string, string> = { ...REQUIRED };
  delete env[key];
  return env;
}

describe('loadEnv', () => {
  it('falla de forma explícita si falta DATABASE_URL', () => {
    expect(() => loadEnv(without('DATABASE_URL'))).toThrow(/DATABASE_URL/);
  });

  it('trata una DATABASE_URL vacía como ausente', () => {
    expect(() => loadEnv({ ...REQUIRED, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('aplica valores por defecto a las variables opcionales', () => {
    expect(loadEnv(REQUIRED)).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      DATABASE_URL,
      CORS_ORIGINS: [],
      SUPABASE_JWT_SECRET,
      JWT_ISSUER,
      JWT_AUDIENCE: 'authenticated',
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      TRUST_PROXY: 0,
    });
  });

  it('TRUST_PROXY es el número de proxies delante del backend', () => {
    expect(loadEnv({ ...REQUIRED, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(() => loadEnv({ ...REQUIRED, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(() => loadEnv({ ...REQUIRED, TRUST_PROXY: '-1' })).toThrow(/TRUST_PROXY/);
  });

  it('convierte CORS_ORIGINS (separado por comas) en una lista sin espacios ni vacíos', () => {
    expect(
      loadEnv({ ...REQUIRED, CORS_ORIGINS: 'http://localhost:8081, https://app.example.com,' })
        .CORS_ORIGINS,
    ).toEqual(['http://localhost:8081', 'https://app.example.com']);
  });

  it('convierte PORT a número', () => {
    expect(loadEnv({ ...REQUIRED, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rechaza un PORT que no es un entero válido', () => {
    expect(() => loadEnv({ ...REQUIRED, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadEnv({ ...REQUIRED, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rechaza un NODE_ENV desconocido', () => {
    expect(() => loadEnv({ ...REQUIRED, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('ignora variables que no forman parte del esquema', () => {
    expect(loadEnv({ ...REQUIRED, PATH: '/usr/bin' })).not.toHaveProperty('PATH');
  });

  describe('autenticación', () => {
    it('falla si falta SUPABASE_JWT_SECRET', () => {
      expect(() => loadEnv(without('SUPABASE_JWT_SECRET'))).toThrow(/SUPABASE_JWT_SECRET/);
    });

    it('rechaza un SUPABASE_JWT_SECRET de menos de 32 caracteres', () => {
      expect(() => loadEnv({ ...REQUIRED, SUPABASE_JWT_SECRET: 'corto' })).toThrow(
        /SUPABASE_JWT_SECRET/,
      );
    });

    it('falla si falta JWT_ISSUER', () => {
      expect(() => loadEnv(without('JWT_ISSUER'))).toThrow(/JWT_ISSUER/);
    });

    it('rechaza un JWT_ISSUER que no es una URL', () => {
      expect(() => loadEnv({ ...REQUIRED, JWT_ISSUER: 'no-es-una-url' })).toThrow(/JWT_ISSUER/);
    });

    it('rechaza un JWT_ISSUER que no es http(s)', () => {
      expect(() => loadEnv({ ...REQUIRED, JWT_ISSUER: 'ftp://test-project.supabase.co' })).toThrow(
        /JWT_ISSUER/,
      );
    });

    it('respeta un JWT_AUDIENCE explícito', () => {
      expect(loadEnv({ ...REQUIRED, JWT_AUDIENCE: 'otra' }).JWT_AUDIENCE).toBe('otra');
    });
  });

  describe('administración de Supabase Auth', () => {
    it('falla si falta SUPABASE_URL', () => {
      expect(() => loadEnv(without('SUPABASE_URL'))).toThrow(/SUPABASE_URL/);
    });

    it('rechaza una SUPABASE_URL que no es http(s)', () => {
      expect(() => loadEnv({ ...REQUIRED, SUPABASE_URL: 'test-project.supabase.co' })).toThrow(
        /SUPABASE_URL/,
      );
    });

    it('falla si falta o está vacía SUPABASE_SERVICE_ROLE_KEY', () => {
      expect(() => loadEnv(without('SUPABASE_SERVICE_ROLE_KEY'))).toThrow(
        /SUPABASE_SERVICE_ROLE_KEY/,
      );
      expect(() => loadEnv({ ...REQUIRED, SUPABASE_SERVICE_ROLE_KEY: '' })).toThrow(
        /SUPABASE_SERVICE_ROLE_KEY/,
      );
    });

    it('no incluye la clave en el mensaje de error', () => {
      expect(() =>
        loadEnv({ ...REQUIRED, SUPABASE_URL: 'mal', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' }),
      ).toThrow(expect.objectContaining({ message: expect.not.stringContaining('sb_secret_x') }));
    });
  });

  describe('Sentry', () => {
    it('SENTRY_DSN es opcional: sin ella (o vacía) no hay DSN', () => {
      expect(loadEnv(REQUIRED).SENTRY_DSN).toBeUndefined();
      expect(loadEnv({ ...REQUIRED, SENTRY_DSN: '' }).SENTRY_DSN).toBeUndefined();
    });

    it('acepta un DSN https y lo conserva', () => {
      const dsn = 'https://abc123@o42.ingest.de.sentry.io/7';
      expect(loadEnv({ ...REQUIRED, SENTRY_DSN: dsn }).SENTRY_DSN).toBe(dsn);
    });

    it('rechaza un SENTRY_DSN que no es una URL http(s)', () => {
      expect(() => loadEnv({ ...REQUIRED, SENTRY_DSN: 'no-es-un-dsn' })).toThrow(/SENTRY_DSN/);
    });

    it('SENTRY_RELEASE es opcional y se conserva si se define', () => {
      expect(loadEnv(REQUIRED).SENTRY_RELEASE).toBeUndefined();
      expect(loadEnv({ ...REQUIRED, SENTRY_RELEASE: 'c424682' }).SENTRY_RELEASE).toBe('c424682');
    });
  });
});

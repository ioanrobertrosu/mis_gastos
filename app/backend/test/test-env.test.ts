import { describe, expect, it } from 'vitest';
import { LOCAL_TEST_DATABASE_URL, testDatabaseUrls } from './helpers/test-env.js';

const REMOTE = 'postgresql://user:pass@remote.example.com:6543/test';
const REMOTE_DIRECT = 'postgresql://user:pass@remote.example.com:5432/test';

describe('testDatabaseUrls', () => {
  it('sin variables usa la BD local de Docker', () => {
    expect(testDatabaseUrls({})).toEqual({
      databaseUrl: LOCAL_TEST_DATABASE_URL,
      directUrl: LOCAL_TEST_DATABASE_URL,
      isLocal: true,
    });
  });

  it('con las dos variables usa esa BD y no Docker', () => {
    expect(testDatabaseUrls({ TEST_DATABASE_URL: REMOTE, TEST_DIRECT_URL: REMOTE_DIRECT })).toEqual(
      {
        databaseUrl: REMOTE,
        directUrl: REMOTE_DIRECT,
        isLocal: false,
      },
    );
  });

  it.each([
    ['solo TEST_DATABASE_URL', { TEST_DATABASE_URL: REMOTE }],
    ['solo TEST_DIRECT_URL', { TEST_DIRECT_URL: REMOTE_DIRECT }],
  ])('falla con una sola variable: %s', (_case, env) => {
    expect(() => testDatabaseUrls(env)).toThrow(/juntas/);
  });

  it.each([
    ['la de runtime', { DATABASE_URL: REMOTE }],
    ['la directa', { DIRECT_URL: REMOTE_DIRECT }],
  ])('nunca acepta la BD de desarrollo: %s', (_case, development) => {
    expect(() =>
      testDatabaseUrls({
        TEST_DATABASE_URL: REMOTE,
        TEST_DIRECT_URL: REMOTE_DIRECT,
        ...development,
      }),
    ).toThrow(/desarrollo/);
  });
});

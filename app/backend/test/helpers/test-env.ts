import 'dotenv/config';

/** BD local de docker-compose.test.yml, que se usa salvo que se indique otra. */
export const LOCAL_TEST_DATABASE_URL =
  'postgresql://mis_gastos:mis_gastos@127.0.0.1:54329/mis_gastos_test';

export interface TestDatabaseUrls {
  databaseUrl: string;
  directUrl: string;
  /** `true` si es la BD local de Docker (la arranca el globalSetup). */
  isLocal: boolean;
}

/**
 * URLs de la BD de test: la local de Docker o, si se definen, `TEST_DATABASE_URL` y
 * `TEST_DIRECT_URL` (ambas). Aborta si apuntan a la BD de desarrollo, porque se vacía en cada test.
 */
export function testDatabaseUrls(env: NodeJS.ProcessEnv = process.env): TestDatabaseUrls {
  const { TEST_DATABASE_URL: databaseUrl, TEST_DIRECT_URL: directUrl } = env;

  if (!databaseUrl && !directUrl) {
    return {
      databaseUrl: LOCAL_TEST_DATABASE_URL,
      directUrl: LOCAL_TEST_DATABASE_URL,
      isLocal: true,
    };
  }
  if (!databaseUrl || !directUrl) {
    throw new Error(
      'Define TEST_DATABASE_URL y TEST_DIRECT_URL juntas, o ninguna para usar Docker',
    );
  }
  if (databaseUrl === env.DATABASE_URL || directUrl === env.DIRECT_URL) {
    throw new Error('La BD de test no puede ser la misma que la de desarrollo');
  }

  return { databaseUrl, directUrl, isLocal: false };
}

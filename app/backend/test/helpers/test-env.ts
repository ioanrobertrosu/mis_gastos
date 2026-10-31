import 'dotenv/config';

/** URLs de la BD de test; aborta si faltan o si apuntan a la BD de desarrollo. */
export function testDatabaseUrls(): { databaseUrl: string; directUrl: string } {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const directUrl = process.env.TEST_DIRECT_URL;

  if (!databaseUrl || !directUrl) {
    throw new Error(
      'Los tests de integración requieren TEST_DATABASE_URL y TEST_DIRECT_URL en .env',
    );
  }
  if (databaseUrl === process.env.DATABASE_URL || directUrl === process.env.DIRECT_URL) {
    throw new Error('La BD de test no puede ser la misma que la de desarrollo');
  }

  return { databaseUrl, directUrl };
}

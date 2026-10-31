import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// La CLI (migraciones) usa la conexión directa; el cliente en runtime usa
// DATABASE_URL (transaction pooler) a través del adaptador de `pg`.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DIRECT_URL ?? '' },
});

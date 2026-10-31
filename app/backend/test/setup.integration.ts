import { afterAll, beforeEach } from 'vitest';
import { resetDatabase, testPrisma } from './helpers/db.js';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

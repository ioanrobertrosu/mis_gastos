import { execFileSync } from 'node:child_process';
import { testDatabaseUrls } from './helpers/test-env.js';

/** Aplica las migraciones pendientes a la BD de test antes de la suite de integración. */
export default function setup(): void {
  let directUrl: string;
  try {
    ({ directUrl } = testDatabaseUrls());
  } catch (error) {
    // Vitest falla al formatear el stack de errores del globalSetup y oculta el mensaje:
    // se fija el stack a mano para que el motivo llegue al usuario.
    const message = error instanceof Error ? error.message : String(error);
    const clean = new Error(message);
    clean.stack = `Error: ${message}`;
    throw clean;
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DIRECT_URL: directUrl },
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
}

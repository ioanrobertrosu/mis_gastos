import { execFileSync } from 'node:child_process';
import { testDatabaseUrls } from './helpers/test-env.js';

const COMPOSE_FILE = '../../docker-compose.test.yml';

/** Ejecuta un comando y, si falla, lanza su salida real (sin URLs, que incluyen contraseñas). */
function run(step: string, command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  try {
    execFileSync(command, args, {
      env,
      stdio: 'pipe',
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
  } catch (error) {
    const { stdout, stderr, message } = error as {
      stdout?: string;
      stderr?: string;
      message: string;
    };
    const output = [stdout, stderr].filter(Boolean).join('\n') || message;
    // Sin `cause` a propósito: el error original lleva la salida sin filtrar.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`${step}:\n${output.replace(/postgres(ql)?:\/\/\S+/gi, '<url>')}`);
  }
}

/** Arranca la BD local si hace falta y aplica las migraciones pendientes antes de la suite. */
export default function setup(): void {
  try {
    const { directUrl, isLocal } = testDatabaseUrls();
    if (isLocal) {
      run('No se pudo arrancar la BD de test en Docker (¿está Docker en marcha?)', 'docker', [
        'compose',
        '-f',
        COMPOSE_FILE,
        'up',
        '-d',
        '--wait',
      ]);
    }
    run(
      'No se pudieron aplicar las migraciones a la BD de test',
      'npx',
      ['prisma', 'migrate', 'deploy'],
      {
        ...process.env,
        DIRECT_URL: directUrl,
      },
    );
  } catch (error) {
    // Vitest falla al formatear el stack de errores del globalSetup y oculta el mensaje:
    // se fija el stack a mano para que el motivo llegue al usuario.
    const message = error instanceof Error ? error.message : String(error);
    const clean = new Error(message);
    clean.stack = `Error: ${message}`;
    throw clean;
  }
}

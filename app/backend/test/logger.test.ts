import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { buildLoggerOptions } from '../src/config/logger.js';
import { fakePrisma } from './helpers/fake-prisma.js';
import { TEST_AUTH } from './helpers/jwt.js';

function captureStream() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, output: () => chunks.join('') };
}

describe('buildLoggerOptions', () => {
  it('redacta las cabeceras authorization y cookie en los logs', async () => {
    const { stream, output } = captureStream();
    const app = await buildApp({
      auth: TEST_AUTH,
      prisma: fakePrisma(),
      logger: { ...buildLoggerOptions('production'), stream },
    });
    app.get('/echo', async (request) => {
      request.log.info({ headers: request.headers }, 'cabeceras recibidas');
      return { ok: true };
    });

    await app.inject({
      method: 'GET',
      url: '/echo',
      headers: { authorization: 'Bearer secreto.jwt.token', cookie: 'sb-session=secreto' },
    });
    await app.close();

    expect(output()).toContain('cabeceras recibidas');
    expect(output()).not.toContain('secreto');
    expect(output()).toContain('[REDACTED]');
  });

  it('en producción emite JSON (sin pino-pretty)', () => {
    expect(buildLoggerOptions('production')).not.toHaveProperty('transport');
  });

  it('en desarrollo usa pino-pretty', () => {
    expect(buildLoggerOptions('development')).toMatchObject({
      transport: { target: 'pino-pretty' },
    });
  });

  it('en test el logger está silenciado', () => {
    expect(buildLoggerOptions('test')).toMatchObject({ level: 'silent' });
  });
});

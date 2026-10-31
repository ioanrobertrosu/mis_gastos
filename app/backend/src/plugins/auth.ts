import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { jwtVerify } from 'jose';
import { UnauthorizedError } from '../shared/errors.js';

/** Usuario autenticado extraído del JWT de Supabase. */
export interface AuthUser {
  sub: string;
  email: string | undefined;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** `preHandler` que exige un JWT válido y rellena `request.user`. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: AuthUser;
  }
}

export interface AuthOptions {
  /** Secreto HS256 del proyecto Supabase (`SUPABASE_JWT_SECRET`). */
  jwtSecret: string;
  issuer: string;
  audience: string;
}

const BEARER = /^Bearer\s+(\S+)$/i;

// Toda la verificación vive aquí: migrar a JWKS (Fase 8) solo cambia este plugin.
export const authPlugin = fp<AuthOptions>(
  async (app, { jwtSecret, issuer, audience }) => {
    const key = new TextEncoder().encode(jwtSecret);

    app.decorateRequest('user', null as unknown as AuthUser);

    app.decorate('authenticate', async (request: FastifyRequest) => {
      const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
      if (!token) throw new UnauthorizedError();

      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          issuer,
          audience,
          requiredClaims: ['sub', 'exp'],
        });
        request.user = {
          sub: payload.sub as string,
          email: typeof payload.email === 'string' ? payload.email : undefined,
        };
      } catch (error) {
        // El motivo concreto solo va al log; el cliente recibe un mensaje genérico.
        request.log.debug({ err: error }, 'JWT rechazado');
        throw new UnauthorizedError();
      }
    });
  },
  { name: 'auth' },
);

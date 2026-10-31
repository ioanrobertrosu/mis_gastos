import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { type JWTPayload, jwtVerify } from 'jose';
import { type IdentityClaims, syncUser } from '../modules/users/user-sync.js';
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

function stringClaim(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Claims de Supabase: `app_metadata.provider` y, en OAuth, `user_metadata.provider_id`. */
function identityClaims(payload: JWTPayload): IdentityClaims {
  const sub = payload.sub as string;
  return {
    sub,
    email: stringClaim(payload, 'email'),
    provider: stringClaim(payload.app_metadata, 'provider') ?? 'email',
    providerId: stringClaim(payload.user_metadata, 'provider_id') ?? sub,
  };
}

// Toda la verificación vive aquí: migrar a JWKS (Fase 8) solo cambia este plugin.
export const authPlugin = fp<AuthOptions>(
  async (app, { jwtSecret, issuer, audience }) => {
    const key = new TextEncoder().encode(jwtSecret);

    app.decorateRequest('user', null as unknown as AuthUser);

    app.decorate('authenticate', async (request: FastifyRequest) => {
      const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
      if (!token) throw new UnauthorizedError();

      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          issuer,
          audience,
          requiredClaims: ['sub', 'exp'],
        }));
      } catch (error) {
        // El motivo concreto solo va al log; el cliente recibe un mensaje genérico.
        request.log.debug({ err: error }, 'JWT rechazado');
        throw new UnauthorizedError();
      }

      const claims = identityClaims(payload);
      await syncUser(app.prisma, claims);
      request.user = { sub: claims.sub, email: claims.email };
    });
  },
  { name: 'auth', dependencies: ['prisma'] },
);

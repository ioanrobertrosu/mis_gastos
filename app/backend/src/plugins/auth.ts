import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';
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
    /** Caducidad del JWT en ms desde epoch: las conexiones largas no pueden sobrevivirle. */
    tokenExpiresAt: number;
  }
}

export interface AuthOptions {
  /** Secreto HS256 del proyecto Supabase (`SUPABASE_JWT_SECRET`). */
  jwtSecret: string;
  issuer: string;
  audience: string;
  /** Claves públicas de firma (JWKS) para los tokens asimétricos (ES256/RS256). */
  jwks?: JWTVerifyGetKey;
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

const ASYMMETRIC_ALGORITHMS = ['ES256', 'RS256'];

/**
 * Elige la clave según el algoritmo del token: HS256 solo con el secreto heredado; ES256/RS256
 * solo con las claves públicas del JWKS. Un token HS256 nunca se verifica con una clave
 * pública (confusión de algoritmo), y `jwtVerify` exige además que `alg` esté en la lista.
 */
function keyResolver(secret: Uint8Array, jwks: JWTVerifyGetKey | undefined): JWTVerifyGetKey {
  return async (header, token) => {
    if (header.alg === 'HS256') return secret;
    if (jwks && ASYMMETRIC_ALGORITHMS.includes(header.alg)) return jwks(header, token);
    throw new Error(`Algoritmo de JWT no admitido: ${header.alg}`);
  };
}

// Toda la verificación vive aquí: HS256 heredado y claves asimétricas de Supabase (JWKS).
export const authPlugin = fp<AuthOptions>(
  async (app, { jwtSecret, issuer, audience, jwks }) => {
    const getKey = keyResolver(new TextEncoder().encode(jwtSecret), jwks);
    const algorithms = ['HS256', ...(jwks ? ASYMMETRIC_ALGORITHMS : [])];

    app.decorateRequest('user', null as unknown as AuthUser);
    app.decorateRequest('tokenExpiresAt', 0);

    app.decorate('authenticate', async (request: FastifyRequest) => {
      const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
      if (!token) throw new UnauthorizedError();

      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, getKey, {
          algorithms,
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
      // `requiredClaims` garantiza que `exp` existe.
      request.tokenExpiresAt = (payload.exp as number) * 1000;
    });
  },
  { name: 'auth', dependencies: ['prisma'] },
);

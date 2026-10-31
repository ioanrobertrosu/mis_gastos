import { SignJWT } from 'jose';
import type { AuthOptions } from '../../src/plugins/auth.js';

export const TEST_AUTH: AuthOptions = {
  jwtSecret: 'secreto-de-test-con-al-menos-32-caracteres',
  issuer: 'https://test-project.supabase.co/auth/v1',
  audience: 'authenticated',
};

export const TEST_USER = {
  sub: '123e4567-e89b-42d3-a456-426614174000',
  email: 'ana@example.com',
  /** ID de la cuenta en el proveedor (Google), en `user_metadata.provider_id`. */
  providerId: '108234567890123456789',
};

export interface TestTokenOptions {
  sub?: string | null;
  /** `null` omite el claim (usuarios sin email). */
  email?: string | null;
  secret?: string;
  issuer?: string;
  audience?: string;
  /** Segundos desde epoch; por defecto, dentro de una hora. */
  expiresAt?: number;
  /** `app_metadata.provider`; por defecto `google`. `null` omite `app_metadata`. */
  provider?: string | null;
  /** `user_metadata`; por defecto `{ provider_id: TEST_USER.providerId }`. */
  userMetadata?: Record<string, unknown>;
}

/** Firma un JWT HS256 con la forma de los de Supabase Auth. */
export async function signTestToken(options: TestTokenOptions = {}): Promise<string> {
  const {
    sub = TEST_USER.sub,
    email = TEST_USER.email,
    secret = TEST_AUTH.jwtSecret,
    issuer = TEST_AUTH.issuer,
    audience = TEST_AUTH.audience,
    expiresAt = Math.floor(Date.now() / 1000) + 3600,
    provider = 'google',
    userMetadata = { provider_id: TEST_USER.providerId },
  } = options;

  const claims = {
    role: 'authenticated',
    ...(provider === null ? {} : { app_metadata: { provider, providers: [provider] } }),
    user_metadata: userMetadata,
  };
  const jwt = new SignJWT(email === null ? claims : { ...claims, email })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresAt);
  if (sub !== null) jwt.setSubject(sub);

  return jwt.sign(new TextEncoder().encode(secret));
}

/** Token sin firmar (`alg: none`), que nunca debe aceptarse. */
export function unsignedToken(): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: TEST_USER.sub,
    email: TEST_USER.email,
    iss: TEST_AUTH.issuer,
    aud: TEST_AUTH.audience,
    exp: now + 3600,
  })}.`;
}

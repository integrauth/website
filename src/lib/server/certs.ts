// ES256 signing for Academy certificate JWTs.
//
// A single active signing key is sufficient for this Worker's scope: the JWT is
// stored as a durable, possibly-offline-verifiable artifact, but the PRIMARY verify
// path (GET /api/academy/certificates/verify/:serial) is a plain DB lookup by
// serial, not a signature check. So no `kid`/JWKS rotation machinery is needed here
// — that's deliberately simpler than the sister repo's own key-rotation setup,
// which exists because the Lab's JWT *is* the primary verification artifact for
// its own session/account flows.

import { importJWK, SignJWT, type JWK, type KeyLike } from 'jose';
import type { Env } from './env';

export interface CertificateClaims {
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  name: string;
  email: string;
  score: number;
}

let cachedDevKey: KeyLike | null = null;

async function getSigningKey(env: Env): Promise<KeyLike> {
  const jwkJson = env.ACADEMY_PRIVATE_JWK;
  if (jwkJson) {
    const jwk = JSON.parse(jwkJson) as JWK;
    return (await importJWK(jwk, 'ES256')) as KeyLike;
  }

  // Local-dev-only fallback: no ACADEMY_PRIVATE_JWK secret configured, so generate an
  // ephemeral P-256 keypair once per isolate and cache it. Certificates signed with it
  // are only ever verifiable within that isolate's lifetime — fine for local testing,
  // never used once the real Wrangler secret is provisioned. Same convention the
  // sister repo uses for its own LAB_PRIVATE_JWK dev fallback.
  if (!cachedDevKey) {
    const keyPair = (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    const { privateKey } = keyPair;
    cachedDevKey = privateKey as unknown as KeyLike;
  }
  return cachedDevKey;
}

/**
 * Signs a compact ES256 JWS for an Academy certificate. `claims.jti` becomes the
 * certificate's public `serial` — generate it with crypto.randomUUID() (or another
 * opaque, unguessable id) before calling this.
 */
export async function signCertificateJwt(env: Env, claims: CertificateClaims): Promise<string> {
  const key = await getSigningKey(env);
  return new SignJWT({ name: claims.name, email: claims.email, score: claims.score })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuedAt(claims.iat)
    .setExpirationTime(claims.exp)
    .sign(key);
}

// Academy certificate cryptography: the ES256 signing key, the signed JWT
// artifact, and the human-transcribable certificate serial format.
//
// Two verification paths exist, and they are deliberately different in kind:
//
//   1. PRIMARY — GET /api/academy/certificates/verify/:serial: a plain DB lookup
//      by serial. This is what /verify on the website uses, and it needs no
//      crypto at all.
//   2. SECONDARY — the signed JWT the learner can hand to an employer, verified
//      offline against the public key published at
//      GET /api/academy/.well-known/jwks.json.
//
// Path 2 only became meaningful once the public half of the key was actually
// published; before that the signature was decorative (signed, but with nothing
// to check it against). Hence `kid` in the JWT header + the JWKS route below —
// still a single never-rotated key, but now a *verifiable* one.

import {
  calculateJwkThumbprint,
  exportJWK,
  importJWK,
  SignJWT,
  type JWK,
  type KeyLike,
} from 'jose';
import type { Env } from './env';

/** `iss` of every Academy certificate JWT. Fixed — this Worker is the only issuer. */
export const CERT_ISSUER = 'https://integrauth.com';

/**
 * `aud` of every Academy certificate JWT: the public verification endpoint the
 * credential is meant to be checked against. A relying party (an employer's
 * verifier, say) should reject a token whose `aud` isn't this, so a JWT minted
 * for some other IntegrAuth purpose can never be replayed as a certificate.
 */
export const CERT_AUDIENCE = 'https://integrauth.com/verify';

/**
 * Claims that go into a certificate JWT. Deliberately does NOT include the
 * learner's email: this token is an artifact learners forward to third parties
 * to prove the credential, and a JWT payload is base64url, not encrypted —
 * anyone it is shown to can read every claim. Name + score + serial are the
 * whole point of the credential; the email is personal data with no role in
 * proving it, so it is not embedded. (The email still lives in the Lab-owned
 * `users` table; it just never leaves it via this path.)
 */
export interface CertificateClaims {
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  name: string;
  score: number;
}

interface SigningMaterial {
  /** Private key used to sign. Never leaves this module. */
  privateKey: KeyLike;
  /** Public half, ready to serve verbatim from the JWKS route (kid/alg/use already set). */
  publicJwk: JWK;
  /** Stamped into every JWT's protected header so a verifier can pick the right JWKS entry. */
  kid: string;
}

/**
 * Per-isolate cache of the imported key. The secret is a Wrangler secret that is
 * "generate once, never rotate" (see env.ts), so re-parsing the JWK and
 * re-running importJWK on every single certificate issuance was pure waste.
 *
 * We cache the in-flight PROMISE, not the resolved value, so that two concurrent
 * first requests share one import instead of both doing the work — which also
 * matters for the dev fallback below, where racing builds would otherwise
 * generate two different ephemeral keypairs and sign certificates with a key
 * that doesn't match the one the JWKS route publishes.
 *
 * Keyed on the raw secret string so a changed binding can never be served from a
 * stale cache (belt-and-braces: bindings don't change mid-isolate).
 */
let cachedMaterial: { source: string; promise: Promise<SigningMaterial> } | null = null;

/** Strips a JWK down to the public EC members, in the exact order RFC 7638 thumbprints require. */
function toPublicEcJwk(jwk: JWK): JWK {
  if (jwk.kty !== 'EC' || !jwk.crv || !jwk.x || !jwk.y) {
    throw new Error('ACADEMY_PRIVATE_JWK is not a P-256 EC JWK');
  }
  // Note the omission of `d` (the private scalar) — that is the entire point of
  // this function. Everything else (kid/alg/use/ext/key_ops/...) is rebuilt
  // explicitly by the caller rather than copied through, so no unexpected member
  // of the private JWK can leak into the published JWKS.
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

async function buildSigningMaterial(jwkJson: string | undefined): Promise<SigningMaterial> {
  if (jwkJson) {
    const jwk = JSON.parse(jwkJson) as JWK;
    const privateKey = (await importJWK(jwk, 'ES256')) as KeyLike;
    const bare = toPublicEcJwk(jwk);
    // Honour an explicit `kid` in the secret if one was provisioned; otherwise
    // derive the RFC 7638 thumbprint, which is stable for the life of the key and
    // needs no coordination with whoever generated it.
    const kid = jwk.kid ?? (await calculateJwkThumbprint(bare, 'sha256'));
    return { privateKey, publicJwk: { ...bare, kid, alg: 'ES256', use: 'sig' }, kid };
  }

  // Local-dev-only fallback: no ACADEMY_PRIVATE_JWK secret configured, so generate an
  // ephemeral P-256 keypair once per isolate. Certificates signed with it are only ever
  // verifiable within that isolate's lifetime — fine for local testing, never used once
  // the real Wrangler secret is provisioned. Same convention the sister repo uses for its
  // own LAB_PRIVATE_JWK dev fallback. We export the public half too so the JWKS route is
  // exercisable locally (and self-consistent: it publishes the very key that just signed).
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  const bare = toPublicEcJwk(await exportJWK(keyPair.publicKey as unknown as KeyLike));
  const kid = await calculateJwkThumbprint(bare, 'sha256');
  return {
    privateKey: keyPair.privateKey as unknown as KeyLike,
    publicJwk: { ...bare, kid, alg: 'ES256', use: 'sig' },
    kid,
  };
}

function getSigningMaterial(env: Env): Promise<SigningMaterial> {
  const source = env.ACADEMY_PRIVATE_JWK ?? '';
  if (!cachedMaterial || cachedMaterial.source !== source) {
    cachedMaterial = { source, promise: buildSigningMaterial(env.ACADEMY_PRIVATE_JWK) };
  }
  return cachedMaterial.promise;
}

/**
 * The public JWK Set served (unauthenticated, cacheable) from
 * GET /api/academy/.well-known/jwks.json. Contains ONLY the public half — the
 * private `d` component is dropped by toPublicEcJwk() above.
 */
export async function getPublicJwks(env: Env): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await getSigningMaterial(env);
  return { keys: [publicJwk] };
}

/**
 * Signs a compact ES256 JWS for an Academy certificate. `claims.jti` is the
 * certificate's public `serial` — mint it with generateCertificateSerial() below
 * before calling this.
 */
export async function signCertificateJwt(env: Env, claims: CertificateClaims): Promise<string> {
  const { privateKey, kid } = await getSigningMaterial(env);
  return new SignJWT({ name: claims.name, score: claims.score })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid })
    .setIssuer(CERT_ISSUER)
    .setAudience(CERT_AUDIENCE)
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuedAt(claims.iat)
    .setExpirationTime(claims.exp)
    .sign(privateKey);
}

// ---------------------------------------------------------------------------
// Certificate serials
// ---------------------------------------------------------------------------

/**
 * Crockford base32: base32 minus I, L, O and U. I/L/O are dropped because they
 * are visually confusable with 1/1/0 when read off a printed certificate, and U
 * because excluding it makes accidental profanity in a random string far less
 * likely. This is the read-it-aloud/type-it-in alphabet, which is the whole
 * requirement here — a serial is a thing a human copies from a PDF into the box
 * at /verify.
 */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const SERIAL_PREFIX = 'IA';
const SERIAL_GROUPS = 3;
const SERIAL_GROUP_LEN = 4;
const SERIAL_BODY_LEN = SERIAL_GROUPS * SERIAL_GROUP_LEN; // 12 characters

/** Longest input normalizeCertificateSerial() will even look at (junk/DoS guard). */
const SERIAL_MAX_INPUT_LEN = 64;

/**
 * Mints a fresh certificate serial in the canonical form `IA-XXXX-XXXX-XXXX`.
 *
 * Entropy: 12 Crockford characters × 5 bits = **60 bits** of CSPRNG output. The
 * property the schema leans on is that a serial is unguessable, because
 * GET /certificates/verify/:serial is public and unauthenticated — a guessable
 * serial would turn it into an enumeration oracle that dumps holder names. At 60
 * bits, an attacker firing 10,000 guesses per second at the endpoint would need
 * ~1.8 million years for a single expected hit, so it comfortably clears that
 * bar while staying short enough to type. (The previous format, a 36-character
 * randomUUID, had more entropy than this and *far* worse ergonomics — nobody is
 * transcribing 32 hex digits and 4 hyphens off a printed certificate correctly.)
 *
 * `& 31` is an unbiased map into the 32-character alphabet precisely because
 * 256 is a whole multiple of 32 — no modulo-bias correction needed.
 */
export function generateCertificateSerial(): string {
  const bytes = new Uint8Array(SERIAL_BODY_LEN);
  crypto.getRandomValues(bytes);

  const groups: string[] = [];
  for (let g = 0; g < SERIAL_GROUPS; g++) {
    let group = '';
    for (let i = 0; i < SERIAL_GROUP_LEN; i++) {
      group += CROCKFORD_ALPHABET[bytes[g * SERIAL_GROUP_LEN + i] & 31];
    }
    groups.push(group);
  }
  return `${SERIAL_PREFIX}-${groups.join('-')}`;
}

/**
 * Canonicalises whatever a human typed into the canonical stored form, or returns
 * null if it can't possibly be one of our serials.
 *
 * Accepts lowercase, missing/extra hyphens, and stray whitespace, and applies
 * Crockford's standard decoding leniency (I and L read as 1, O reads as 0) —
 * those letters are never *emitted*, so treating them as their digit lookalikes
 * is unambiguous and rescues the most common transcription mistakes.
 *
 * Returning null (rather than querying with garbage) means malformed input is
 * answered as "no such certificate" without touching D1 at all.
 */
export function normalizeCertificateSerial(input: string): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > SERIAL_MAX_INPUT_LEN) {
    return null;
  }

  const compact = input.toUpperCase().replace(/[\s-]+/g, '');
  if (!compact.startsWith(SERIAL_PREFIX)) return null;

  const body = compact.slice(SERIAL_PREFIX.length).replace(/[IL]/g, '1').replace(/O/g, '0');
  if (body.length !== SERIAL_BODY_LEN) return null;
  for (const ch of body) {
    if (!CROCKFORD_ALPHABET.includes(ch)) return null;
  }

  const groups: string[] = [];
  for (let g = 0; g < SERIAL_GROUPS; g++) {
    groups.push(body.slice(g * SERIAL_GROUP_LEN, (g + 1) * SERIAL_GROUP_LEN));
  }
  return `${SERIAL_PREFIX}-${groups.join('-')}`;
}

// OIDC Relying Party against the Lab's OpenID Provider (lab.integrauth.com).
//
// WHY THIS EXISTS: see session.ts's header. Short version — the two apps share one user base, and
// the first design shared one `Domain=.integrauth.com` session cookie to achieve it. That handed
// every sibling `*.integrauth.com` host the ability to overwrite a visitor's session. The fix is
// for each app to hold its own host-locked cookie and for this site to obtain identity the
// standards-correct way: OIDC Authorization Code + PKCE.
//
// WHAT THIS DELIBERATELY DOES NOT DO, and why the flow is smaller than a general-purpose RP's:
//
//   - **No access token is kept, and no refresh token is requested.** An RP normally hoards those
//     to call the provider's APIs later. This site has no such calls left: after login, every
//     cross-origin call to lab.integrauth.com is gone (that was the point of the redesign), and
//     everything we need about the user — their id and email — is in the ID token itself. So the
//     access token from the exchange is read and dropped, and we never ask for `offline_access`.
//     That also keeps our requested scope exactly equal to the scope the Lab seeds this client
//     with (`openid email`), which is what lets an existing grant auto-approve with no consent
//     screen — the difference between a one-click popup and a form to fill in.
//   - **No userinfo call.** Same reason: `email` and `email_verified` are ID-token claims under
//     scope `email`, so a second round trip would tell us nothing new.
//   - **No silent/`prompt=none` authentication.** The provider does not implement it, and its
//     `frame-ancestors 'none'` makes the hidden-iframe workaround structurally impossible. The
//     consequence is a real, accepted UX change: being signed in at the Lab no longer signs you in
//     here automatically — it takes one click on "Sign in".
//
// The lifetime of the OIDC artifacts is therefore the login handshake and nothing more. What
// persists afterwards is purely our own session row (session.ts) — the ID token's `sub` becomes
// its `user_id`, and the ID token's `sid` becomes its `oidc_sid` so back-channel logout can find
// it again.

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { base64Url, parseCookie, randomToken, isSecureRequest } from './session';
import type { Env } from './env';

/** The provider's issuer identifier. Must equal the `iss` claim exactly, so no trailing slash. */
export const DEFAULT_ISSUER = 'https://lab.integrauth.com';

/** The client_id the Lab seeds for this site (`WEBSITE_CLIENT_ID` in its oidc.ts). */
export const DEFAULT_CLIENT_ID = 'integrauth-website';

/**
 * Scope requested at /authorize. Kept EXACTLY equal to the scope the Lab seeds this client with.
 *
 * This is load-bearing, not cosmetic: the provider auto-approves without a consent screen only
 * when the stored grant's scope COVERS the requested scope. Ask for one scope more than the seeded
 * grant — `offline_access`, say — and every returning user gets a consent prompt instead of a
 * popup that closes by itself. Since we need no refresh token (see the file header), there is
 * nothing to gain by asking.
 */
export const REQUESTED_SCOPE = 'openid email';

/** The OIDC back-channel logout event URI (OIDC Back-Channel Logout 1.0 §2.4). */
const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

/**
 * How long a login handshake may take. Covers "click sign in, get redirected, type an OTP at the
 * Lab, come back" — generous, but the transaction cookie holds a live PKCE verifier, so it should
 * not be open-ended.
 */
const TX_TTL_SECONDS = 15 * 60;

/** Transaction-cookie names, split by scheme for the same reason the session cookie is. */
const TX_COOKIE_PROD = '__Host-ia_oidc_tx';
const TX_COOKIE_DEV = 'ia_oidc_tx';

/**
 * Max age accepted on a back-channel logout token.
 *
 * This is a SECOND bound, not the only one: the Lab now stamps a two-minute `exp` on every logout
 * token, which `jwtVerify` enforces, so the effective window is that shorter one. We keep our own
 * ceiling anyway because it is the half we control — a provider that stopped setting `exp` should
 * not silently hand us unbounded replay.
 *
 * We deliberately keep no single-use `jti` cache. A replay here re-revokes an already-revoked
 * session, which is idempotent, so the cache would buy nothing that the two bounds above do not,
 * at the cost of a table in a database this repo does not own. BCL 1.0 makes it a MAY.
 */
const LOGOUT_TOKEN_MAX_AGE = '5 minutes';

export interface RpConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Absolute callback URL. Must byte-match one of the Lab's registered redirect URIs. */
  redirectUri: string;
}

export interface LoginTransaction {
  state: string;
  nonce: string;
  verifier: string;
  /** Same-origin path to send the user back to. Already validated by `safeReturnPath`. */
  ret: string;
  /** 'popup' closes itself and signals the opener; 'redirect' navigates back to `ret`. */
  mode: 'popup' | 'redirect';
}

export interface IdTokenIdentity {
  /** The Lab's internal user id. `subject_types_supported` is `public`, so this is stable and
   *  identical across clients — which is exactly why it can key our own tables. */
  userId: string;
  email: string | null;
  emailVerified: boolean;
  /** The OP session id. Null only if the provider omitted it, which would make this session
   *  unreachable by back-channel logout — see `createSession`. */
  sid: string | null;
}

export function txCookieName(url: URL): string {
  return isSecureRequest(url) ? TX_COOKIE_PROD : TX_COOKIE_DEV;
}

/**
 * Resolves RP configuration from the environment, or null when it is not fully provisioned.
 *
 * Returning null rather than throwing is deliberate: the site must keep serving pages when the
 * OIDC secret has not been set yet (it is provisioned out of band, and the whole point of the
 * staged cutover is that the Worker runs before every secret is in place). The routes turn a null
 * config into a clean "sign-in is temporarily unavailable" rather than a 500.
 */
export function rpConfigFromEnv(env: Env, requestUrl: URL): RpConfig | null {
  const secret = (env.IA_WEBSITE_OIDC_SECRET ?? '').trim();
  if (!secret) return null;

  const issuer = (env.LAB_ISSUER ?? DEFAULT_ISSUER).trim().replace(/\/+$/, '');
  const clientId = (env.OIDC_CLIENT_ID ?? DEFAULT_CLIENT_ID).trim();

  // Derived from the live request rather than configured, so the same build works on
  // *.workers.dev, on localhost, and on integrauth.com with no redeploy. The Lab matches redirect
  // URIs by exact string equality, so every origin this Worker answers on must appear verbatim in
  // its IA_WEBSITE_REDIRECT_URIS list.
  const redirectUri = `${requestUrl.origin}/auth/callback`;

  return { issuer, clientId, clientSecret: secret, redirectUri };
}

/** URLs derived from the issuer. Hardcoded rather than discovered — see `buildAuthorizeUrl`. */
export function authorizeEndpoint(issuer: string): string {
  return `${issuer}/authorize`;
}
export function tokenEndpoint(issuer: string): string {
  return `${issuer}/oidc/token`;
}
export function jwksUri(issuer: string): string {
  return `${issuer}/.well-known/jwks.json`;
}
export function endSessionEndpoint(issuer: string): string {
  return `${issuer}/oidc/logout`;
}

/**
 * Remote JWK Set, cached per issuer for the isolate's lifetime.
 *
 * `createRemoteJWKSet` handles its own caching and re-fetch-on-unknown-kid, which is what makes
 * provider key rotation a non-event for us. Keyed by URL so a config change cannot be served a
 * previous provider's keys.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getJwks(issuer: string) {
  const uri = jwksUri(issuer);
  let jwks = jwksCache.get(uri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(uri));
    jwksCache.set(uri, jwks);
  }
  return jwks;
}

/** SHA-256 → base64url, i.e. a PKCE S256 `code_challenge`. */
export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/**
 * Validates a caller-supplied post-login destination.
 *
 * Anything that is not a plain, same-origin, absolute path is replaced with `/academy`. The cases
 * being excluded are the classic open-redirect payloads: `//evil.com` (protocol-relative — a URL
 * parser reads it as a host, not a path), `https://evil.com`, and `/\evil.com` (backslash, which
 * some browsers normalise to `/`). Rejecting rather than sanitising means a hostile value never
 * gets a second chance at being "cleaned up" into something exploitable.
 *
 * WHY ALL C0 CONTROL CHARACTERS AND NOT JUST CR/LF. This previously blocked `\n` and `\r` and let
 * TAB through, which was a live open redirect: the WHATWG URL parser strips tab, CR and LF from its
 * input BEFORE parsing, so `/<TAB>/evil.com` — which passes a naive "starts with a single slash"
 * test — resolves to `https://evil.com/`. Verified: `new URL("/\t/evil.com", "https://integrauth.com").href`
 * is `"https://evil.com/"`. Tab is a legal HTTP header-value character too, so it survived all the
 * way into `Location:`, and it round-tripped through JSON into the popup's `location.replace`. The
 * lesson is that enumerating the two separators everyone remembers is the wrong shape of check, so
 * this now rejects the whole C0 range plus DEL and every Unicode whitespace character — none of
 * which has any business in a path we generated.
 *
 * The final `new URL` re-parse is the belt-and-braces version of the same idea: whatever the string
 * looks like to us, if a real URL parser does not resolve it to the same-origin path we think it is,
 * it does not ship.
 */
export function safeReturnPath(raw: string | null | undefined, fallback = '/academy'): string {
  if (!raw) return fallback;
  if (raw.length > 512) return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//')) return fallback;
  if (raw.includes('\\')) return fallback;
  // C0 controls + DEL, and any Unicode whitespace (which includes \t \n \r \f \v and friends).
  if (/[\x00-\x1f\x7f]/.test(raw)) return fallback;
  if (/\s/.test(raw)) return fallback;

  // Authoritative check: resolve it the way a browser will. If the result is not on our own origin,
  // or the path no longer matches what we were given, refuse it.
  try {
    const probe = new URL(raw, 'https://relying-party.invalid');
    if (probe.origin !== 'https://relying-party.invalid') return fallback;
    if (probe.pathname + probe.search + probe.hash !== raw) return fallback;
  } catch {
    return fallback;
  }
  return raw;
}

/**
 * Bytes of CSPRNG output behind the PKCE `code_verifier`.
 *
 * 32 bytes is 43 base64url characters unpadded, and RFC 7636 §4.1 sets the verifier's legal range
 * at 43-128 characters — so this sits exactly ON the floor, and the provider enforces that floor
 * (`/^[A-Za-z0-9._~-]{43,128}$/`) at the token endpoint.
 *
 * It gets its own named constant purely so that boundary is visible. `randomToken()`'s default is
 * shared with session tokens, `state` and `nonce`, none of which have a lower bound anywhere near
 * this; someone trimming that default to 24 bytes for unrelated reasons would take the verifier to
 * 32 characters and break EVERY login with `invalid_grant` at the exchange — an error that points
 * at the code, the client secret and the redirect URI long before it points at a token length.
 */
const PKCE_VERIFIER_BYTES = 32;

/** Mints a fresh login transaction: `state`, `nonce`, and a PKCE verifier. */
export function newTransaction(ret: string, mode: 'popup' | 'redirect'): LoginTransaction {
  return {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(PKCE_VERIFIER_BYTES),
    ret,
    mode,
  };
}

/**
 * Builds the authorization request URL.
 *
 * Endpoints come from `authorizeEndpoint()` etc. rather than from a discovery fetch. That is a
 * considered choice: the provider is a single, known, first-party deployment whose paths are
 * pinned by its own tests, and a discovery round trip on every sign-in click would add latency
 * plus a new way for login to fail (a cached-but-stale document, a discovery outage) in exchange
 * for flexibility we do not use. If the Lab ever moves these paths, this is the one place to edit.
 */
export function buildAuthorizeUrl(config: RpConfig, tx: LoginTransaction, challenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: REQUESTED_SCOPE,
    state: tx.state,
    nonce: tx.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${authorizeEndpoint(config.issuer)}?${params.toString()}`;
}

/** Serializes a transaction into a `Set-Cookie`. */
export function buildTxCookie(url: URL, tx: LoginTransaction): string {
  // Plain (unsigned, unencrypted) JSON is adequate here, and it is worth being explicit about why
  // rather than reaching for a MAC out of habit. The cookie is `__Host-`-prefixed, so a browser
  // will refuse any `Set-Cookie` for it that carries a `Domain` — no sibling subdomain can write
  // it, which is the threat that would otherwise matter. The only remaining writer is same-origin
  // script, and a same-origin XSS already owns the session outright; signing would not change
  // that. Forging a transaction also buys nothing on its own: the `state` in it must match the
  // `state` the provider echoes back, and the provider only echoes a `state` it was given.
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(tx)));
  const parts = [
    `${txCookieName(url)}=${payload}`,
    'Path=/',
    'HttpOnly',
    // Lax, not Strict: the callback arrives as a top-level cross-site GET redirect from the Lab,
    // and Strict withholds cookies on exactly that navigation — the flow would complete and then
    // fail to find its own transaction.
    'SameSite=Lax',
    `Max-Age=${TX_TTL_SECONDS}`,
  ];
  if (isSecureRequest(url)) parts.push('Secure');
  return parts.join('; ');
}

/** Clears the transaction cookie. Attributes must match the setter for the browser to drop it. */
export function clearTxCookie(url: URL): string {
  const parts = [`${txCookieName(url)}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecureRequest(url)) parts.push('Secure');
  return parts.join('; ');
}

/** Reads and parses the transaction cookie, or null if absent/corrupt. */
export function readTxCookie(cookieHeader: string | null, url: URL): LoginTransaction | null {
  const raw = parseCookie(cookieHeader, txCookieName(url));
  if (!raw) return null;
  try {
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))
    );
    const parsed = JSON.parse(json) as Partial<LoginTransaction>;
    if (
      typeof parsed.state !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.verifier !== 'string'
    ) {
      return null;
    }
    return {
      state: parsed.state,
      nonce: parsed.nonce,
      verifier: parsed.verifier,
      ret: safeReturnPath(parsed.ret),
      mode: parsed.mode === 'redirect' ? 'redirect' : 'popup',
    };
  } catch {
    return null;
  }
}

/**
 * Constant-time string comparison, used for the `state` check.
 *
 * `state` is compared with this rather than `===` on principle: it is an attacker-influenced value
 * checked against a secret-ish one, which is the shape where an early-exit comparison leaks. The
 * practical leak here is small (both values are per-transaction and short-lived), but the cost of
 * doing it properly is four lines.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class OidcError extends Error {
  constructor(
    public code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'OidcError';
  }
}

/**
 * Exchanges an authorization code for tokens, then verifies the ID token.
 *
 * Returns only the identity we keep. The access token is deliberately not returned: nothing in
 * this codebase has a use for it (see the file header), and handing callers a credential they do
 * not need is how it ends up logged or persisted by accident.
 */
export async function exchangeCode(
  config: RpConfig,
  code: string,
  tx: LoginTransaction
): Promise<IdTokenIdentity> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: tx.verifier,
  });

  // client_secret_basic: the method the Lab registers for this client. The secret goes in the
  // Authorization header rather than the body so it stays out of any request-body logging.
  const basic = btoa(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`);

  const response = await fetch(tokenEndpoint(config.issuer), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Fall through to the status check — a non-JSON body from the token endpoint is a provider
    // problem, and reporting it as `token_endpoint_error` is more honest than guessing.
  }

  if (!response.ok) {
    const code = typeof payload.error === 'string' ? payload.error : `http_${response.status}`;
    throw new OidcError(code, `token endpoint rejected the exchange: ${code}`);
  }

  const idToken = payload.id_token;
  if (typeof idToken !== 'string' || !idToken) {
    throw new OidcError('missing_id_token', 'token response carried no id_token');
  }

  return verifyIdToken(config, idToken, tx.nonce);
}

/**
 * Verifies an ID token's signature and claims, returning the identity it asserts.
 *
 * `jwtVerify` covers signature, `iss` and `aud`, and validates `exp`/`iat` — but only when they are
 * present, which is why `requiredClaims` pins them: OIDC Core §2 makes `exp` REQUIRED in an ID
 * token, and without the pin a token minted without one would verify here and then never expire.
 * The `nonce` check is ours to make and is the one that matters most: it is what binds this ID
 * token to the authorization request WE started, and without it a token replayed from another
 * login would sail through every other check.
 */
export async function verifyIdToken(
  config: RpConfig,
  idToken: string,
  expectedNonce: string
): Promise<IdTokenIdentity> {
  let claims: JWTPayload;
  try {
    const verified = await jwtVerify(idToken, getJwks(config.issuer), {
      issuer: config.issuer,
      audience: config.clientId,
      algorithms: ['ES256'],
      requiredClaims: ['exp', 'iat', 'sub'],
    });
    claims = verified.payload;
  } catch (error) {
    throw new OidcError('invalid_id_token', `id_token failed verification: ${String(error)}`);
  }

  // OIDC Core §3.1.3.7 steps 3-5. `jwtVerify`'s `audience` option is satisfied when our client id is
  // merely CONTAINED in a multi-valued `aud`, which is not the same as the token being meant for us.
  // The spec's answer is that a multi-valued `aud` REQUIRES an `azp` naming the intended party — and
  // when `azp` is present at all, step 5 says to verify it names US. The Lab only ever mints
  // single-audience ID tokens without `azp` today, so neither branch can fire — they are here
  // because the day that changes, the failure is silent acceptance of a token issued for somebody
  // else.
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (audiences.length > 1 && claims.azp !== config.clientId) {
    throw new OidcError('invalid_id_token', 'multi-audience id_token without a matching azp');
  }
  if (claims.azp !== undefined && claims.azp !== config.clientId) {
    throw new OidcError('invalid_id_token', 'id_token azp names a different client');
  }

  const nonce = typeof claims.nonce === 'string' ? claims.nonce : '';
  if (!nonce || !timingSafeEqual(nonce, expectedNonce)) {
    throw new OidcError('nonce_mismatch', 'id_token nonce did not match this login attempt');
  }

  const sub = typeof claims.sub === 'string' ? claims.sub.trim() : '';
  if (!sub) {
    throw new OidcError('missing_sub', 'id_token carried no usable sub');
  }

  return {
    userId: sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    emailVerified: claims.email_verified === true,
    sid: typeof claims.sid === 'string' && claims.sid ? claims.sid : null,
  };
}

export interface LogoutTokenClaims {
  sid: string | null;
  sub: string | null;
}

/**
 * Verifies an OIDC Back-Channel Logout token (OIDC Back-Channel Logout 1.0 §2.6).
 *
 * The spec's validation rules that are easy to skip and matter:
 *   - `typ` must be `logout+jwt`, so an ID token cannot be replayed here as a logout instruction.
 *   - the `events` claim must actually contain the back-channel-logout event.
 *   - a `nonce` claim must be ABSENT. Its presence means the token was minted as an ID token, and
 *     accepting it would let a captured ID token log the user out.
 *   - at least one of `sub`/`sid` must be present, or there is nothing to act on.
 *
 * The Lab stamps a two-minute `exp` on every logout token (jose enforces it), and `maxTokenAge` is
 * this side's own independent bound — belt and braces, since either alone stops an intercepted
 * token from being replayed indefinitely. `jti` is pinned via `requiredClaims` because §2.6 makes
 * it REQUIRED; there is deliberately no replay cache behind it (revocation is idempotent), so the
 * pin is spec conformance, not replay defence.
 */
export async function verifyLogoutToken(
  config: RpConfig,
  logoutToken: string
): Promise<LogoutTokenClaims> {
  let claims: JWTPayload;
  try {
    const verified = await jwtVerify(logoutToken, getJwks(config.issuer), {
      issuer: config.issuer,
      audience: config.clientId,
      algorithms: ['ES256'],
      typ: 'logout+jwt',
      maxTokenAge: LOGOUT_TOKEN_MAX_AGE,
      requiredClaims: ['iat', 'jti'],
    });
    claims = verified.payload;
  } catch (error) {
    throw new OidcError('invalid_logout_token', `logout_token failed verification: ${String(error)}`);
  }

  if ('nonce' in claims) {
    throw new OidcError('logout_token_has_nonce', 'logout_token must not carry a nonce claim');
  }

  const events = claims.events;
  const hasEvent =
    typeof events === 'object' &&
    events !== null &&
    Object.prototype.hasOwnProperty.call(events, BACKCHANNEL_LOGOUT_EVENT);
  if (!hasEvent) {
    throw new OidcError('logout_token_missing_event', 'logout_token lacked the back-channel event');
  }

  const sid = typeof claims.sid === 'string' && claims.sid ? claims.sid : null;
  const sub = typeof claims.sub === 'string' && claims.sub ? claims.sub : null;
  if (!sid && !sub) {
    throw new OidcError('logout_token_missing_subject', 'logout_token named neither sid nor sub');
  }

  return { sid, sub };
}

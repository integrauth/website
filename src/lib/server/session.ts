// This site's OWN session store, backed by the shared D1 table `website_sessions`.
//
// HISTORY, because the shape of this file only makes sense with it: an earlier design had
// lab.integrauth.com mint ONE session cookie (`__Secure-ia_session`, `Domain=.integrauth.com`)
// that both apps trusted, and this module merely *validated* it. That was rejected. Cookie
// identity is `(name, domain, path)` and the `__Secure-` prefix only demands TLS — it does not
// restrict WHO MAY SET the cookie (`__Host-` does, which is exactly why `__Host-` forbids a
// `Domain` attribute). So any of the ~30 sibling `*.integrauth.com` hosts — the 27 free-tool
// subdomains, the product apps, the demo sites — could have replied
// `Set-Cookie: __Secure-ia_session=<attacker token>; Domain=.integrauth.com` and overwritten a
// visitor's session: session fixation (the victim's progress, real name and certificates land in
// the attacker's account) plus an unclearable forced-logout. It also meant the browser shipped the
// session token to all ~30 of those hosts on every request.
//
// The replacement: each app holds its OWN host-locked cookie, and this site is an OIDC Relying
// Party against the Lab's OpenID Provider (see oidc-rp.ts). This module therefore now MINTS,
// validates and revokes sessions — but only ever rows in `website_sessions`, which exists for
// exactly this purpose. It still never touches the Lab-owned `sessions` or `users` tables.
//
// Schema ownership stays with the `integrauth/lab` repo (migration 0052). Never run a migration
// from this repo against this database.

/**
 * Session cookie names. TWO of them, and the split is a security control, not a convenience.
 *
 * `__Host-` demands Secure + Path=/ + NO Domain attribute, and — the part that matters — a
 * browser refuses a `__Host-`-prefixed `Set-Cookie` that carries a `Domain`. That is precisely
 * what makes the cookie unwritable by sibling subdomains and closes the fixation hole described
 * in the file header.
 *
 * `__Host-` also requires the Secure attribute, which a plain `http://localhost` dev server
 * cannot satisfy in every browser, so local dev gets an unprefixed name. THE DEV NAME MUST NEVER
 * BE ACCEPTED OVER HTTPS: `ia_web_session` carries no prefix, so in production a sibling
 * subdomain could set it with `Domain=.integrauth.com` and we would be right back to session
 * fixation — with the added insult of having built the OIDC flow to avoid it. `sessionCookieName()`
 * below is the single place that decides, keyed off the request scheme, and callers must use it
 * rather than picking a constant.
 */
export const SESSION_COOKIE_PROD = '__Host-ia_web_session';
export const SESSION_COOKIE_DEV = 'ia_web_session';

/**
 * Idle-expiry window: a session untouched for this long is treated as expired even though its
 * absolute `expires_at` is still in the future. 400 days, matching the Lab's own convention —
 * and also the practical ceiling browsers clamp any cookie's real lifetime to, so asking for
 * more in `Max-Age` buys nothing.
 */
export const IDLE_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * Absolute session lifetime. Deliberately very long (matching the Lab's own `ABSOLUTE_MS`): the
 * product requirement is that signing in survives browser restarts and is not re-prompted every
 * month. The real bound on a forgotten session is IDLE_MS above, not this; this is the backstop
 * that guarantees no row lives forever.
 */
export const ABSOLUTE_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * How old the browser's copy of the cookie may get before a validated request re-issues it.
 *
 * This mirrors the bug the Lab repo fixed in its migration 0051, and it is worth restating so it
 * is not reintroduced here: the tempting condition is "refresh if the session has not been seen
 * for a while", which is exactly backwards. That measures the gap since the LAST REQUEST, so a
 * visitor who comes back daily never qualifies and is silently logged out when the browser hits
 * its ~400-day cookie cap, while someone who visits twice a year refreshes forever. What has to
 * be measured is the AGE OF THE ISSUED COOKIE, which is what `cookie_issued_at` records.
 */
export const COOKIE_REISSUE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How stale `last_seen_at` may get before a successful validation bothers writing a fresh one.
 *
 * THE TRADEOFF: writing on every request turns each authenticated call — including pure reads
 * like GET /progress, and the Academy frontend fans several out per page load — into a write
 * against a database SHARED with the Lab app. Coarsening to an hour means `last_seen_at` can lag
 * reality by up to an hour, i.e. a session could survive 400 days + 1 hour of true idleness
 * rather than exactly 400 days: a 0.01% error against this window that changes no security
 * property. The same throttle would be indefensible against a 15-minute idle window, so if
 * IDLE_MS is ever shortened, revisit this constant in the same commit.
 *
 * The idle CHECK is not throttled — only the write is. Expiry decisions always use the exact
 * stored value.
 */
export const LAST_SEEN_REFRESH_MS = 60 * 60 * 1000;

/** Cap on `ua_summary`, which is only ever shown back to the account's owner in a device list. */
const MAX_UA_SUMMARY_LEN = 180;

export interface ValidatedSession {
  userId: string;
  sessionId: string;
  /** The account's email, read from the Lab-owned `users` table for display in the navbar. */
  email: string | null;
  /**
   * True when the browser's cookie is old enough to be worth re-issuing AND the caller said it
   * is in a position to set one (see `canIssueCookie`). Callers that cannot set a cookie must
   * ignore this; callers that can should Set-Cookie and then call `markCookieIssued`.
   */
  shouldReissueCookie: boolean;
}

export interface ValidateSessionOptions {
  /**
   * Whether this caller can actually attach a `Set-Cookie` to its response. Defaults to false so
   * that a route which merely reads the session cannot burn the re-issue window without acting on
   * it — otherwise `cookie_issued_at` gets stamped forward by a request that sent no cookie at
   * all, and the browser's copy quietly ages out anyway. Same opt-in shape the Lab uses.
   */
  canIssueCookie?: boolean;
}

/**
 * Only the columns validateSession() reads. `token_hash` is deliberately absent: it is the lookup
 * key, so we already hold it, and reading it back tells us nothing.
 *
 * The last two come from the Lab-owned `users` table via a join — see `validateSession` for why
 * that join is worth its cost. Named explicitly rather than `SELECT *` because `users` is a table
 * whose shape this repo does not control and which may grow columns we have no business reading.
 */
interface SessionRow {
  id: string;
  user_id: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  cookie_issued_at: string | null;
  user_status: string | null;
  user_email: string | null;
}

export interface WebsiteSessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  uaSummary: string | null;
  current: boolean;
}

/**
 * Hostnames on which the unprefixed, non-`Secure` DEV cookie name may be used. Nothing else, ever.
 *
 * WHY THIS IS A HOST ALLOWLIST AND NOT `url.protocol !== 'https:'`. Keying the choice on the scheme
 * alone looks equivalent and is not. It correctly refuses the dev name over HTTPS, but it happily
 * SERVES the dev name to any plaintext `http://integrauth.com` request that reaches this Worker —
 * and `ia_web_session` has no `__Host-` prefix, so any of the ~30 sibling `*.integrauth.com` hosts
 * can set it with `Domain=.integrauth.com`. That is exactly the session-fixation vector the whole
 * OIDC redesign was built to eliminate (see this file's header), reintroduced through the back door.
 * Nothing in either repo forces HTTPS at the zone level, and our HSTS header deliberately omits
 * `preload`, so a browser's first-ever contact with the domain is not covered by it either.
 *
 * Keying on the host removes the dependency on zone configuration entirely: on any real hostname the
 * only cookie name that exists is the `__Host-`-prefixed one, which a sibling cannot write.
 */
const DEV_COOKIE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

/** True when this request is addressed to a local development host. */
function isLocalDevHost(url: URL): boolean {
  return DEV_COOKIE_HOSTS.has(url.hostname);
}

/** Picks the cookie name valid for this request. See DEV_COOKIE_HOSTS for why it keys on the host. */
export function sessionCookieName(url: URL): string {
  return isLocalDevHost(url) ? SESSION_COOKIE_DEV : SESSION_COOKIE_PROD;
}

/**
 * True when cookies may carry `Secure` / a `__Host-` prefix.
 *
 * Anything that is not a local dev host is treated as secure REGARDLESS of the request scheme: on a
 * real hostname we always want the `__Host-` prefix and `Secure`, and a plaintext request there is
 * something to refuse to serve a usable cookie to, not something to downgrade for.
 */
export function isSecureRequest(url: URL): boolean {
  return !isLocalDevHost(url) || url.protocol === 'https:';
}

/**
 * Extracts one named cookie from a raw `Cookie` header, or null. Simple `;`-split / first-`=`-split
 * parse: every cookie this module reads is an opaque base64url token or our own JSON transaction
 * blob, so there is nothing to unquote or percent-decode.
 */
export function parseCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() === name) {
      return trimmed.slice(eq + 1).trim();
    }
  }
  return null;
}

/** Convenience wrapper: reads the session cookie appropriate to `url`'s scheme. */
export function parseSessionCookie(
  cookieHeader: string | null | undefined,
  url: URL
): string | null {
  return parseCookie(cookieHeader, sessionCookieName(url));
}

/** Hex-encodes the SHA-256 digest of `input` — how `token_hash` is stored. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** base64url of `bytes`, no padding — used for session tokens and PKCE values alike. */
export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 bytes of CSPRNG output, base64url-encoded: session tokens, `state`, `nonce`, PKCE verifier. */
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/**
 * Builds a `Set-Cookie` for the session.
 *
 * `SameSite=Lax` rather than `Strict` on purpose. The OIDC callback arrives as a top-level
 * cross-site GET redirect from lab.integrauth.com, and `Strict` withholds cookies on exactly
 * that navigation — with `Strict` a user would complete the whole flow and land back logged out.
 * `Lax` sends cookies on top-level GETs only, so it does not weaken CSRF posture for the
 * state-changing requests that matter (which are POSTs, and are separately Origin-checked in
 * api.ts).
 */
export function buildSessionCookie(url: URL, token: string, maxAgeSeconds: number): string {
  const secure = isSecureRequest(url);
  const parts = [
    `${sessionCookieName(url)}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeSeconds)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Builds the `Set-Cookie` that clears the session cookie. Attributes must match the setter. */
export function clearSessionCookie(url: URL): string {
  const secure = isSecureRequest(url);
  const parts = [`${sessionCookieName(url)}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Condenses a User-Agent into something worth showing in a "your devices" list. Not a
 * fingerprint and not security-relevant — a truncated, human-readable hint so the owner can tell
 * "my laptop" from "someone else's phone" when revoking. Stored verbatim otherwise, which is why
 * it is length-capped.
 */
export function summarizeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const trimmed = ua.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_UA_SUMMARY_LEN ? trimmed.slice(0, MAX_UA_SUMMARY_LEN) : trimmed;
}

export interface CreatedSession {
  /** The RAW token. Goes in the cookie and is never stored — only its SHA-256 lands in D1. */
  token: string;
  sessionId: string;
  maxAgeSeconds: number;
}

/**
 * Mints a brand-new session row and returns the raw token for the caller to put in a cookie.
 *
 * `oidcSid` is the `sid` claim from the ID token that authorized this login. It is the join key
 * OIDC Back-Channel Logout needs: when the Lab signs a user out everywhere it fans a logout token
 * out to each RP holding that `sid`, and `revokeSessionsBySid` below is how this site honours it.
 * Nullable in the schema, but we should always have one in practice — a null means back-channel
 * logout can never reach this row.
 */
export async function createSession(
  db: D1Database,
  params: { userId: string; oidcSid: string | null; uaSummary: string | null }
): Promise<CreatedSession> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresIso = new Date(now + ABSOLUTE_MS).toISOString();

  await db
    .prepare(
      `INSERT INTO website_sessions
         (id, user_id, token_hash, oidc_sid, created_at, last_seen_at, expires_at, revoked_at, cookie_issued_at, ua_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    )
    .bind(
      sessionId,
      params.userId,
      tokenHash,
      params.oidcSid,
      nowIso,
      nowIso,
      expiresIso,
      nowIso,
      params.uaSummary
    )
    .run();

  // The cookie's Max-Age is bounded by IDLE_MS, not ABSOLUTE_MS. A cookie that outlives the idle
  // window is worse than useless: the browser keeps presenting a token the server will always
  // reject, so the user looks signed in until the first request that needs the session fails.
  return { token, sessionId, maxAgeSeconds: Math.floor(IDLE_MS / 1000) };
}

/**
 * Validates a raw session token against D1, returning `{ userId, sessionId }` or null.
 *
 * On success this touches `last_seen_at` (throttled — see LAST_SEEN_REFRESH_MS) and reports
 * whether the browser's cookie is due for re-issue.
 */
export async function validateSession(
  db: D1Database,
  token: string | null,
  options: ValidateSessionOptions = {}
): Promise<ValidatedSession | null> {
  if (!token) return null;

  const tokenHash = await sha256Hex(token);

  // JOINed against the Lab-owned `users` table, which wrangler.toml explicitly permits us to READ.
  // Two things ride on this join, both of which would otherwise be bugs:
  //
  //   - **A disabled account stays signed in here forever.** Our session is deliberately
  //     independent of the Lab's, so nothing about the Lab disabling an account (or the account
  //     being erased under RTBF, which removes the `users` row) would otherwise reach us: the
  //     `website_sessions` row remains live and valid on its own terms. An INNER join makes a
  //     missing user row fail validation, and the `status` check below makes a disabled one fail
  //     too, so both propagate on the very next request.
  //   - **The navbar needs the email.** Reading it here costs nothing extra, where a second query
  //     from /auth/session would double the round trips on the site's most frequent API call.
  const row = await db
    .prepare(
      `SELECT ws.id, ws.user_id, ws.last_seen_at, ws.expires_at, ws.revoked_at, ws.cookie_issued_at,
              u.status AS user_status, u.email AS user_email
         FROM website_sessions ws
         JOIN users u ON u.id = ws.user_id
        WHERE ws.token_hash = ?`
    )
    .bind(tokenHash)
    .first<SessionRow>();

  if (!row) return null;
  if (row.revoked_at !== null && row.revoked_at !== undefined) return null;
  // ALLOWLIST, not a denylist: only the literal 'active' passes. The previous form let a NULL status
  // through, which is unreachable today (users.status is NOT NULL DEFAULT 'active' in migration 0001,
  // and the INNER JOIN above guarantees the row exists) but is the wrong shape for a table this repo
  // does not own — the day the Lab adds a 'pending' or 'locked' status, or makes the column nullable,
  // this check must fail closed rather than wave the new state through.
  if (row.user_status !== 'active') return null;

  const now = Date.now();

  const expiresAtMs = Date.parse(row.expires_at);
  if (Number.isFinite(expiresAtMs) && now > expiresAtMs) return null;

  const lastSeenAtMs = Date.parse(row.last_seen_at);
  if (Number.isFinite(lastSeenAtMs) && now - lastSeenAtMs > IDLE_MS) return null;

  // An unparseable stored timestamp counts as "needs refreshing", so a corrupt value heals on the
  // next request instead of sticking around forever.
  const needsLastSeenWrite =
    !Number.isFinite(lastSeenAtMs) || now - lastSeenAtMs > LAST_SEEN_REFRESH_MS;

  const cookieIssuedMs = row.cookie_issued_at ? Date.parse(row.cookie_issued_at) : NaN;
  const cookieIsStale =
    !Number.isFinite(cookieIssuedMs) || now - cookieIssuedMs > COOKIE_REISSUE_AFTER_MS;
  const shouldReissueCookie = Boolean(options.canIssueCookie) && cookieIsStale;

  // One statement for both timestamps when both are due — this is a write against a database the
  // Lab also uses, so it is worth not doing twice.
  if (needsLastSeenWrite || shouldReissueCookie) {
    const nowIso = new Date(now).toISOString();
    if (shouldReissueCookie) {
      await db
        .prepare('UPDATE website_sessions SET last_seen_at = ?, cookie_issued_at = ? WHERE id = ?')
        .bind(nowIso, nowIso, row.id)
        .run();
    } else {
      await db
        .prepare('UPDATE website_sessions SET last_seen_at = ? WHERE id = ?')
        .bind(nowIso, row.id)
        .run();
    }
  }

  return {
    userId: row.user_id,
    sessionId: row.id,
    email: row.user_email,
    shouldReissueCookie,
  };
}

/** Revokes one session by id. Idempotent: re-revoking keeps the original `revoked_at`. */
export async function revokeSession(db: D1Database, sessionId: string): Promise<void> {
  await db
    .prepare('UPDATE website_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), sessionId)
    .run();
}

/**
 * Revokes every session belonging to `userId`, optionally sparing one.
 *
 * `exceptSessionId` exists because "sign out my other devices" should not log the user out of the
 * device they are asking from — the same self-service-safe shape the Lab's own revoke-all has.
 */
export async function revokeSessionsByUser(
  db: D1Database,
  userId: string,
  exceptSessionId?: string
): Promise<number> {
  const nowIso = new Date().toISOString();
  const result = exceptSessionId
    ? await db
        .prepare(
          'UPDATE website_sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL'
        )
        .bind(nowIso, userId, exceptSessionId)
        .run()
    : await db
        .prepare(
          'UPDATE website_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL'
        )
        .bind(nowIso, userId)
        .run();
  return result.meta?.changes ?? 0;
}

/**
 * Revokes every session logged in under a given OP `sid`. This is the entire point of the
 * `oidc_sid` column: it is how OIDC Back-Channel Logout reaches this site when the user signs out
 * at the Lab. Returns the number of rows actually revoked, which the logout route logs — a zero
 * is normal (this browser may never have signed in here) and must not be reported as an error, or
 * the Lab will retry a logout that already has nothing to do.
 */
export async function revokeSessionsBySid(db: D1Database, sid: string): Promise<number> {
  const result = await db
    .prepare(
      'UPDATE website_sessions SET revoked_at = ? WHERE oidc_sid = ? AND revoked_at IS NULL'
    )
    .bind(new Date().toISOString(), sid)
    .run();
  return result.meta?.changes ?? 0;
}

/**
 * Lists a user's live sessions for the account panel's device list.
 *
 * Applies the SAME liveness rules `validateSession` enforces, rather than just `revoked_at IS
 * NULL` — otherwise the panel shows sessions that any real request would reject, which is the
 * exact defect the Lab repo fixed in its own `listActiveSessionsByUser`. The idle cut-off is
 * computed here rather than in SQL so both paths derive from one IDLE_MS.
 */
export async function listSessions(
  db: D1Database,
  userId: string,
  currentSessionId: string,
  limit = 50
): Promise<WebsiteSessionSummary[]> {
  const nowIso = new Date().toISOString();
  const idleCutoffIso = new Date(Date.now() - IDLE_MS).toISOString();

  const result = await db
    .prepare(
      `SELECT id, created_at, last_seen_at, ua_summary
         FROM website_sessions
        WHERE user_id = ?
          AND revoked_at IS NULL
          AND expires_at > ?
          AND last_seen_at > ?
        ORDER BY last_seen_at DESC
        LIMIT ?`
    )
    .bind(userId, nowIso, idleCutoffIso, limit)
    .all<{ id: string; created_at: string; last_seen_at: string; ua_summary: string | null }>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    uaSummary: row.ua_summary,
    current: row.id === currentSessionId,
  }));
}

/**
 * Confirms a session belongs to a user before acting on it.
 *
 * Used by the revoke-one-device route: without this check the session id — which the panel hands
 * to the browser — would be an IDOR letting any signed-in learner revoke a stranger's session.
 */
export async function sessionBelongsToUser(
  db: D1Database,
  sessionId: string,
  userId: string
): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM website_sessions WHERE id = ? AND user_id = ?')
    .bind(sessionId, userId)
    .first<{ id: string }>();
  return Boolean(row);
}

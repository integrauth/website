// Read-only validator for the shared TRUE-SSO session cookie minted by lab.integrauth.com.
//
// This module NEVER creates, refreshes, or revokes a session — it only answers
// "is this cookie currently valid, and if so, whose is it?" and (at most once an
// hour per session) touches `last_seen_at` for idle-expiry bookkeeping.
// Login/OTP/logout all happen on lab.integrauth.com; the `sessions` and `users`
// tables are owned by that repo's migrations.

/** Name of the shared SSO cookie, set with Domain=.integrauth.com by the Lab. */
export const SESSION_COOKIE = '__Secure-ia_session';

/** Idle-expiry window: a session with no activity for this long is treated as expired,
 *  even if it hasn't hit its absolute `expires_at` yet. 400 days, matching the Lab's
 *  own convention for long-lived "remember me" style sessions. */
export const IDLE_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * How stale `last_seen_at` must be before a successful validation bothers writing
 * a fresh one. See validateSession() for the tradeoff this buys.
 */
export const LAST_SEEN_REFRESH_MS = 60 * 60 * 1000; // 1 hour

export interface ValidatedSession {
  userId: string;
  sessionId: string;
}

/**
 * Only the columns validateSession() actually reads. `sessions` is a Lab-owned
 * table whose shape this repo does not control and whose full column set may
 * grow to hold things we have no business reading (device fingerprints, step-up
 * state, and whatever the Lab adds next), so the SELECT below names its columns
 * explicitly rather than using `SELECT *`. Note `token_hash` is absent: it's the
 * lookup key, so we already have it — reading it back tells us nothing.
 */
interface SessionRow {
  id: string;
  user_id: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
}

/**
 * Parses the raw `Cookie` request header and extracts the value of SESSION_COOKIE,
 * or null if absent. Simple `; `-split / first-`=`-split parser — cookie values here
 * are opaque base64url tokens, no special character handling is needed beyond that.
 */
export function parseSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name === SESSION_COOKIE) {
      return trimmed.slice(eq + 1).trim();
    }
  }
  return null;
}

/** Hex-encodes the SHA-256 digest of `input`, matching how the Lab stores `token_hash`. */
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

/**
 * Validates a raw session token (the cookie value, NOT the hash) against D1.
 * Returns the associated { userId, sessionId } if the session is valid, else null.
 *
 * On success, touches `last_seen_at` so idle-expiry tracking stays accurate — but
 * only when the stored value is already more than LAST_SEEN_REFRESH_MS stale. This
 * is the only write this module ever performs against the Lab-owned `sessions`
 * table, and it is a narrow, expected exception to "read-only" (the Lab's own
 * session code does the same touch on validated requests).
 *
 * THE TRADEOFF, spelled out: writing on *every* request turned each authenticated
 * API call — including pure reads like GET /progress — into a write against a
 * database SHARED with the Lab app, and the Academy frontend fans out several
 * calls per page load. That's a lot of contention and a lot of billed D1 writes to
 * maintain a timestamp whose only consumer is a 400-DAY idle window. Coarsening it
 * to an hour means `last_seen_at` can lag reality by up to an hour, i.e. a session
 * could survive at most 400 days + 1 hour of true idleness instead of exactly 400
 * days. Against a 400-day window that is a 0.01% error and changes no security
 * property; the same throttle would be wrong for a 15-minute idle window, so if
 * the Lab ever shortens IDLE_MS, revisit this constant with it.
 *
 * The idle CHECK itself is unchanged and still uses the exact stored value — only
 * the write is throttled, never the expiry decision.
 */
export async function validateSession(
  db: D1Database,
  token: string | null
): Promise<ValidatedSession | null> {
  if (!token) return null;

  const tokenHash = await sha256Hex(token);

  const row = await db
    .prepare(
      'SELECT id, user_id, last_seen_at, expires_at, revoked_at FROM sessions WHERE token_hash = ?'
    )
    .bind(tokenHash)
    .first<SessionRow>();

  if (!row) return null;
  if (row.revoked_at !== null && row.revoked_at !== undefined) return null;

  const now = Date.now();

  const expiresAtMs = Date.parse(row.expires_at);
  if (Number.isFinite(expiresAtMs) && now > expiresAtMs) return null;

  const lastSeenAtMs = Date.parse(row.last_seen_at);
  if (Number.isFinite(lastSeenAtMs) && now - lastSeenAtMs > IDLE_MS) return null;

  // An unparseable stored timestamp (!isFinite) is treated as "needs refreshing",
  // so a corrupt value gets healed on the next request rather than sticking around.
  const needsRefresh = !Number.isFinite(lastSeenAtMs) || now - lastSeenAtMs > LAST_SEEN_REFRESH_MS;
  if (needsRefresh) {
    const nowIso = new Date(now).toISOString();
    await db
      .prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
      .bind(nowIso, row.id)
      .run();
  }

  return { userId: row.user_id, sessionId: row.id };
}

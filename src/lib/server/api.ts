// Hono app mounted at /api/academy/* by src/worker.ts.
//
// Auth: every route requires this site's own session cookie (minted at OIDC
// callback time — see auth.ts/session.ts) EXCEPT two public ones
// — the certificate-verification lookup (GET /certificates/verify/:serial), which
// by design needs no cookie because anyone holding a serial should be able to
// confirm it's real, and the JWKS endpoint (GET /.well-known/jwks.json), which
// publishes the public half of the certificate signing key. Security headers
// (incl. the strict JSON CSP) and `Cache-Control: no-store` are applied uniformly
// by worker.ts, not here (the JWKS route opts back out of no-store — see there).
//
// Two abuse defenses live in this file, and neither is a general rate limiter:
//
//   1. CSRF origin + content-type guard (guardStateChanging, below) on every
//      state-changing method. Necessary because the ~30 sibling *.integrauth.com
//      subdomains are SAME-SITE with us — they share the registrable domain — so
//      SameSite=Lax stops nothing between them, even though our `__Host-` cookie
//      means they cannot WRITE it. See guardStateChanging's own header.
//   2. Per-user daily caps on the two endpoints that INSERT rows with no natural
//      bound into a database shared with the Lab app, plus total-row ceilings on
//      the progress-sync tables (which have no daily cap because a real learner
//      syncs constantly). Explicitly backstops, not rate limiters — see
//      MAX_*_PER_DAY and MAX_STORED_* below.
//   3. A minimum interval between calls to POST /progress/reset. That route grows
//      no rows at all — one epoch row per learner, forever — so neither of the
//      above applied to it, and it was for a while the one authenticated write
//      here with no bound of any kind (audit finding R22-W-08): each call is an
//      upsert plus up to three DELETEs against the shared D1, and one session
//      could issue them as fast as it could send. It is bounded by elapsed time
//      rather than a count because there is nothing per-reset to count without a
//      migration, which this repo may not write — see
//      MIN_PROGRESS_RESET_INTERVAL_MS in store.ts.
//
// A real per-IP/per-session limiter would need a Durable Object or KV
// (in-memory-per-isolate counters aren't reliable on Workers, since concurrent
// requests can land on different isolates). That remains disproportionate for this
// Worker's write surface; the SQL guards are the right size for the actual risk.

import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { Env } from './env';
import { parseSessionCookie, validateSession } from './session';
import {
  getProfile,
  getProfileOrEmpty,
  upsertProfile,
  lockProfileNameIfAbsent,
  listLessonProgress,
  unionLessonProgress,
  listQuizProgress,
  unionQuizMasks,
  getLastPosition,
  setLastPosition,
  clearLastPosition,
  deleteLessonProgress,
  deleteQuizProgress,
  getProgressEpoch,
  bumpProgressEpoch,
  getLastProgressResetAt,
  progressResetRetryAfterSeconds,
  insertExamAttempt,
  listExamAttempts,
  countExamAttemptsSince,
  countExamAttemptsByIpSince,
  oldestExamAttemptSince,
  scrubExamAttemptIpHashesBefore,
  claimSweepWindow,
  getExamAttemptById,
  insertCertificateIfAbsent,
  recomputeBestCertificate,
  listCertificates,
  getCertificateByAttemptId,
  getBestCertificateScore,
  countCertificatesSince,
  getCertificateBySerial,
  countLessonProgress,
  countQuizProgress,
  MAX_LESSON_ROWS_SQL,
  MAX_TRACK_ROWS_SQL,
} from './store';
import {
  signCertificateJwt,
  getPublicJwks,
  generateCertificateSerial,
  certificateSerialLookupCandidates,
} from './certs';
import {
  EXAM_QUESTION_COUNT,
  gradeExam,
  isKnownQuestion,
  isWellFormedDraw,
  type SubmittedAnswer,
} from './exam';
import { clientIpFromHeader, hashClientIp } from './ip';
import { SWEEP_JOB_EXAM_IP, sweepWindowStartSeconds } from './sweep';

interface Vars {
  userId: string;
  sessionId: string;
}

type AppEnv = { Bindings: Env; Variables: Vars };

const MAX_LESSON_IDS = 500;
const MAX_TRACK_IDS = 50;
const MAX_NAME_LEN = 80;

/**
 * Ceilings on how many rows ONE learner may accumulate, as opposed to how many they may send per
 * request (MAX_LESSON_IDS / MAX_TRACK_IDS above). Both sit far above the real curriculum — 135
 * lessons, 12 tracks — so no learner can reach them, including one who re-reads everything. See
 * `countLessonProgress` in store.ts for why a total bound is the only one available. Aliases of
 * store.ts's in-statement guards so the two layers cannot drift apart.
 */
const MAX_STORED_LESSON_ROWS = MAX_LESSON_ROWS_SQL;
const MAX_STORED_TRACK_ROWS = MAX_TRACK_ROWS_SQL;

/**
 * How far ahead of our own clock a client-supplied `lastPosition.updatedAt` may be. A device's clock
 * being a few minutes out is ordinary; being a year out is either broken or an attempt to pin the
 * saved position forever, since the merge is last-write-wins on this value.
 */
const POSITION_CLOCK_SKEW_MS = 10 * 60 * 1000;

// EXAM_QUESTION_COUNT / EXAM_PASS_PERCENT now come from ./exam, alongside the answer key that grades
// against them — the exam's shape and the code that enforces it live in one place. The old
// `legacy-local-pass` sentinel is GONE: with the server grading from submitted answers, a pass with
// no answers cannot be honestly graded, so there is no longer a shape that lets a score be asserted
// rather than earned. A learner who passed anonymously before signing in re-takes the (server-graded)
// exam; their browser's local record is only ever a display hint now.

/**
 * Characters refused in a learner's name. The name is snapshotted onto a certificate, published by
 * the PUBLIC /certificates/verify/:serial route, and permanently locked at first issuance — so this
 * is the last point at which anything can be rejected.
 *
 * Not an XSS control (verify.html escapes correctly, and the canvas draws text): an IMPERSONATION
 * one. `U+202E` and friends visually reverse the text that follows them, zero-width characters let
 * two different names render identically, and newlines/tabs break the certificate layout. `\p{C}`
 * covers control, format, surrogate, private-use and unassigned code points; the explicit additions
 * are bidi controls and zero-width joiners/spaces, which are `\p{Cf}` and so already covered —
 * listed anyway so the intent survives an edit.
 *
 * WHAT THIS DELIBERATELY DOES NOT STOP, so nobody reads more into it than is here: homoglyphs and
 * combining marks. `\p{C}` contains no `\p{M}` and no confusable letters, so "Аlice" with a Cyrillic
 * A, or "Alice" with a combining acute, is accepted, locked at first certificate issuance, and then
 * published by the public verify route as a visually identical twin of a real holder's name. Closing
 * that means script-mixing or confusable-skeleton rules, which is a product decision (it rejects
 * legitimate multi-script names) rather than a missing line of code. An earlier version of this
 * comment cited combining characters as motivation, which read as though they were handled.
 *
 * Written with explicit \u escapes: the code points here are by definition invisible, so spelling
 * them out is the only way the set can be reviewed or edited safely.
 */
const FORBIDDEN_NAME_CHARS = /[\p{C}\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;

/**
 * The ONLY origins allowed to make a state-changing request to this API.
 *
 * Exact string match, no suffix matching, no regex: `https://integrauth.com.evil.com`
 * and `https://evilintegrauth.com` are the classic ways a "does it end with our
 * domain?" check gets defeated, and an allowlist of two literals cannot be fooled
 * that way. Note what is deliberately NOT here: lab.integrauth.com and the other
 * ~30 *.integrauth.com subdomains. They no longer share our session cookie (it is
 * `__Host-`-prefixed — see session.ts), but they are still SAME-SITE with us, so the
 * browser sends our cookie on requests they originate. A stored XSS on any one of
 * them could therefore drive this API as the logged-in learner if this allowlist
 * did not exist. See `guardStateChanging` below.
 */
export const ALLOWED_ORIGINS = ['https://integrauth.com', 'https://www.integrauth.com'] as const;

/**
 * Whether `origin` may make a state-changing request to us.
 *
 * Two ways to qualify, and the second is not a loosening: an Origin equal to the origin this very
 * request was addressed to is BY DEFINITION same-origin, which is the strongest case there is. It
 * is listed explicitly because ALLOWED_ORIGINS names only the two production hostnames, and
 * without this branch every state-changing call 403s on the *.workers.dev URL (kept enabled
 * post-cutover purely so CI has a bot-challenge-free host to probe, per wrangler.toml) and on
 * http://localhost during local dev — the exact "can't sign in locally" symptom this repo hit
 * before.
 *
 * It does not open a hole: `url.origin` comes from the request's own Host, and a browser sets Host
 * from the URL it is fetching, so a cross-origin attacker page aimed at integrauth.com still
 * presents ITS origin against a Host of integrauth.com and still fails. Spoofing Host instead
 * gains nothing — the attacker would still need the victim's cookie, which the browser will only
 * attach to the real host.
 */
export function isAllowedOrigin(origin: string, url: URL): boolean {
  if (origin === url.origin) return true;
  return (ALLOWED_ORIGINS as readonly string[]).includes(origin);
}

/** Methods that can change server state, and therefore need the CSRF guard. */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Caps on how much a caller may write per 24 hours. Enforced with a single `SELECT COUNT(*)` over
 * the window, so they are cheap and stateless (no DO, no KV, no
 * in-isolate counters that concurrency would defeat).
 *
 * NOT exact under concurrency, and the earlier version of this comment claiming otherwise was
 * wrong. These are check-then-insert: N requests issued together each read a count below the limit
 * and each then inserts, so the cap can be overshot by roughly the concurrency factor. That is
 * tolerable HERE — the overshoot is bounded per 24-hour window, certificate issuance is idempotent
 * per attempt, and the point is to stop a scripted account writing unbounded rows, which it still
 * does. It would NOT be tolerable for the progress tables, whose ceiling has no window to bound it,
 * which is why that one is additionally re-checked inside each insert (see MAX_LESSON_ROWS_SQL in
 * store.ts). Do not describe either as exact.
 *
 * They exist first because both guarded endpoints are authenticated INSERTs with no
 * natural bound, into a D1 instance SHARED with the sister Lab app — a single
 * scripted account could otherwise write rows until it degraded a database this
 * repo does not own. What they are NOT for: they don't limit read traffic and they don't smooth
 * bursts.
 *
 * THE EXAM LIMIT IS NO LONGER ONLY A BACKSTOP. At 20 per account per day it was sized so that no
 * real learner could ever meet it; at THREE it is a product rule — the exam is unproctored and its
 * questions ship in the public bundle (see ./exam), so unlimited retakes make a passing score a
 * matter of persistence rather than knowledge. Three per rolling 24 hours is enough to fail, study
 * and pass in a day, and not enough to grind. Two consequences follow and are handled rather than
 * hoped away: a learner WILL hit this limit legitimately, so the 429 says which limit was hit and
 * when the next attempt frees up (see `rateLimitResponse`), and the client shows the remaining
 * count up front instead of letting someone spend twenty minutes on a sitting that cannot be
 * recorded.
 *
 * AND IT IS ALSO PER NETWORK. An account is free to create, so a per-account cap alone is a cap on
 * nothing — the same person signs up again and has three more. The per-IP half is what makes the
 * number mean something, at the cost of being coarse in the way IP limits always are: a household,
 * an office or a campus behind one NAT shares one bucket, and those learners will see a limit they
 * did not personally spend. That is why the 429 distinguishes the two scopes in so many words rather
 * than saying "too many attempts" — a shared-network learner needs to know it was not them, and that
 * they are not locked out of the Academy, only out of submitting an exam for a while.
 */
const MAX_EXAM_ATTEMPTS_PER_DAY = 3;
const MAX_EXAM_ATTEMPTS_PER_IP_PER_DAY = 3;
const MAX_CERTIFICATES_PER_DAY = 20;
const ABUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

function isNonEmptyShortString(value: unknown, maxLen: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLen;
}

/**
 * A name we are willing to print on a publicly verifiable credential and then lock forever.
 * Length + non-blankness (as everywhere else) plus a character-class refusal — see
 * FORBIDDEN_NAME_CHARS. Internal runs of whitespace are collapsed by the caller, not rejected,
 * because "Mary  Jane" is a typo rather than an attack.
 */
function isAcceptableName(value: unknown): value is string {
  if (!isNonEmptyShortString(value, MAX_NAME_LEN)) return false;
  return !FORBIDDEN_NAME_CHARS.test(value);
}

/** Trims, then collapses internal whitespace runs to single spaces. */
function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** ISO timestamp marking the start of the abuse-counting window ending now. */
function abuseWindowStartIso(): string {
  return new Date(Date.now() - ABUSE_WINDOW_MS).toISOString();
}

/**
 * Erase exam `ip_hash` values that have aged out of the counting window.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE WRITE PATH (audit finding R22-W-02). The submission handler
 * below already scrubs on every attempt, and that is the cheap, common case. But it is driven
 * ENTIRELY by a subsequent submission, and the exam is the only sign-in-gated action on this site:
 * a quiet week leaves the last attempts' hashes in place indefinitely, and the very last attempt
 * before traffic stops is never scrubbed at all, because nothing runs after it.
 *
 * It reuses `abuseWindowStartIso()` deliberately, and that is a correctness requirement rather than
 * tidiness: the scrub MUST use the same window start the counts use — see the note on
 * `scrubExamAttemptIpHashesBefore` — so a later boundary can never erase keys still being counted.
 * **Do not "improve" this by scrubbing earlier than the window** to make an erasure deadline look
 * tighter: erasing a hash that is still inside the counting window under-counts that connection's
 * attempts and hands out extra exam tries, on the limit protecting a credential learners give to
 * employers. The retention floor is the counting window, and it is not negotiable from here.
 */
export async function sweepExpiredExamIpHashes(db: D1Database): Promise<void> {
  await scrubExamAttemptIpHashesBefore(db, abuseWindowStartIso());
}

/**
 * Run the sweep at most once an hour, from whichever request happens to claim the hour.
 *
 * **This is the cron trigger's replacement, and there is no cron trigger to be had.** The Cloudflare
 * account is at the Workers Free plan's limit of 5 cron triggers account-wide, all five held by
 * other products — three attempts to add a sixth for this Worker were refused by the schedules API
 * (the full account is in `wrangler.toml`). The lab repo hit the same wall and answered it the same
 * way, in `maybeRunCleanup`: claim a window atomically, do the work in `waitUntil`. This is that
 * pattern, with the claim in D1 because this Worker has no Durable Object.
 *
 * **Adds nothing to anyone's latency.** The claim is one indexed write, and the sweep itself runs in
 * `waitUntil` after the response is on its way. A claim that throws returns false rather than
 * propagating: housekeeping must never fail the request it rode in on.
 *
 * WHAT THIS DOES AND DOES NOT GUARANTEE, stated because `privacy.html` makes a public commitment
 * about it and the difference is real:
 *
 *   - Worst-case retention is **the counting window plus one sweep window** — 24h + up to 1h. It
 *     cannot be less than the counting window (see `sweepExpiredExamIpHashes`), so "erased at
 *     exactly 24 hours" was never achievable by any mechanism, cron included.
 *   - It needs SOME request to arrive. `run_worker_first` routes only `/api/academy/*` and `/auth/*`
 *     here, so static page views do not trigger it. In practice any learner opening a lesson syncs
 *     progress and claims the hour; under genuinely zero traffic nothing runs, and the erasure
 *     happens on the next request instead. `privacy.html` says so rather than implying a timer.
 *
 * Called from `worker.ts` for BOTH prefixes rather than from this app's middleware, so that a
 * sign-in or a session refresh is as good a trigger as an Academy API call.
 */
export async function maybeSweepExpiredExamIpHashes(
  db: D1Database,
  waitUntil: ((p: Promise<unknown>) => void) | undefined,
  now: () => number = Date.now
): Promise<boolean> {
  if (!waitUntil) return false;
  const windowStart = sweepWindowStartSeconds(now());
  let claimed = false;
  try {
    claimed = await claimSweepWindow(db, SWEEP_JOB_EXAM_IP, windowStart);
  } catch {
    return false;
  }
  if (!claimed) return false;
  waitUntil(sweepExpiredExamIpHashes(db).catch(() => undefined));
  return true;
}

/**
 * When the next attempt frees up, given the oldest attempt still inside the window.
 *
 * A rolling window, not a calendar day: the slot that oldest attempt occupies is released exactly
 * one window after it was taken. Null in (and only in) the case where nothing is in the window,
 * which cannot happen on the rejection path but is representable, and which the client renders as
 * "no wait" rather than as an unknown.
 */
function nextAttemptIso(oldestInWindow: string | null): string | null {
  if (!oldestInWindow) return null;
  const takenMs = Date.parse(oldestInWindow);
  if (!Number.isFinite(takenMs)) return null;
  return new Date(takenMs + ABUSE_WINDOW_MS).toISOString();
}

/** Whole seconds from now until `iso`, floored at 1 — the shape `Retry-After` wants. */
function retryAfterSeconds(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(1, Math.ceil(ms / 1000));
}

/**
 * The 429 for an exhausted exam allowance.
 *
 * Carries `scope` because the two limits need genuinely different words from the UI — "you have used
 * your three attempts" versus "this network has" — and a learner on a shared connection who is told
 * only "too many attempts" will reasonably conclude their own account is broken. Carries
 * `nextAttemptAt` so the answer to "when?" is a time rather than a shrug, and mirrors it into
 * `Retry-After` for anything that is not our own front end.
 */
function rateLimitResponse(
  c: Context<AppEnv>,
  scope: 'account' | 'network',
  limit: number,
  nextAttemptAt: string | null
) {
  const retryAfter = retryAfterSeconds(nextAttemptAt);
  return c.json(
    { error: 'rate_limited', scope, limit, windowHours: ABUSE_WINDOW_MS / 3600000, nextAttemptAt },
    429,
    retryAfter ? { 'Retry-After': String(retryAfter) } : undefined
  );
}

export function createApp() {
  const app = new Hono<AppEnv>().basePath('/api/academy');

  /**
   * CSRF guard for every state-changing request. Registered before any route so it
   * runs ahead of requireSession — a forged request should be rejected on its shape,
   * without us doing a session lookup for it.
   *
   * WHY THIS IS LOAD-BEARING AND NOT DEFENCE IN DEPTH — do not delete it on the reasoning that
   * the `__Host-` cookie plus `SameSite=Lax` have made it redundant. They have not, and an earlier
   * version of this comment claimed they had, which is precisely the mistake that would reopen the
   * hole. `SameSite` is about SITE, not ORIGIN: `oidcscan.integrauth.com` and `integrauth.com` share
   * the registrable domain `integrauth.com`, so a `fetch()` from any of the ~30 sibling subdomains
   * is SAME-SITE, and `Lax` withholds nothing from it — our session cookie is attached in full. The
   * `__Host-` prefix stops a sibling from WRITING our cookie (which is what killed the old
   * shared-cookie design, see session.ts's header); it does nothing to stop a sibling from SPENDING
   * it. What actually blocks a stored XSS on a sibling from driving this API as the logged-in
   * learner is this Origin allowlist, plus:
   *
   *   - Hono's `c.req.json()` parses a body regardless of the declared Content-Type. Without the
   *     media-type check below, a cross-origin form/fetch POST with `text/plain` is a CORS
   *     "simple request" — no preflight to fail — whose body our handlers would happily read.
   *     Requiring `application/json` forces any cross-origin attempt into a preflight that we
   *     answer with no CORS headers at all.
   *
   * Two independent checks, either of which alone closes that hole:
   *
   *   - Origin must be an exact member of ALLOWED_ORIGINS. Browsers always send
   *     Origin on non-GET/HEAD requests, including same-origin ones, so a missing
   *     Origin means "not a browser form/fetch we're willing to trust" and is
   *     rejected rather than waved through. (Non-browser callers — curl, scripts —
   *     must send it explicitly. That's intentional: this API exists to serve the
   *     website, and it holds no API-token auth scheme for anything else.)
   *   - Content-Type must be application/json. This kills the no-preflight
   *     `text/plain`/form-encoded variant outright and means any cross-origin
   *     attempt now requires a preflight that we answer with no CORS headers at all.
   */
  const guardStateChanging: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!STATE_CHANGING_METHODS.has(c.req.method.toUpperCase())) {
      return next();
    }

    const origin = c.req.header('Origin');
    if (!origin || !isAllowedOrigin(origin, new URL(c.req.url))) {
      return c.json({ error: 'forbidden_origin' }, 403);
    }

    // Compare only the media type: a legitimate `application/json; charset=utf-8`
    // must pass, while `application/json-but-not-really` must not.
    const mediaType = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return c.json({ error: 'unsupported_media_type' }, 415);
    }

    return next();
  };

  app.use('*', guardStateChanging);

  const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
    // `canIssueCookie` is deliberately left off: cookie re-issue is GET /auth/session's job, since
    // that is the call the frontend always makes and can therefore always act on the result. See
    // session.ts's COOKIE_REISSUE_AFTER_MS comment.
    const token = parseSessionCookie(c.req.header('Cookie'), new URL(c.req.url));
    const session = await validateSession(c.env.DB, token);
    if (!session) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('userId', session.userId);
    c.set('sessionId', session.sessionId);
    await next();
  };

  // -------------------------------------------------------------------------
  // public key material
  // -------------------------------------------------------------------------

  /**
   * Public JWK Set for the certificate signing key. Without this, the signature on
   * a certificate JWT was decorative: signed, but with no published key anyone
   * could check it against. A holder can now hand the JWT to a third party who
   * verifies it offline (ES256, `kid` from the token header, `iss`/`aud` per
   * certs.ts) with no call to us at all.
   *
   * Deliberately: no session, no cookie read, and safe to cache — it contains only
   * public key material for a key that never rotates. The Cache-Control set here is
   * preserved by worker.ts, which otherwise pins `no-store` on every API response
   * (correct for the session-scoped routes, wrong for this one).
   */
  app.get('/.well-known/jwks.json', async (c) => {
    const jwks = await getPublicJwks(c.env);
    c.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    // `*` CORS, which is right here and nowhere else in this API. The whole point of the endpoint is
    // that a THIRD PARTY the holder forwarded a certificate JWT to can verify it, and a verifier
    // built in a browser could not fetch this at all without the header — which quietly made the
    // stated purpose above untrue. Safe because the response is public key material with no
    // credentials involved: it is identical for every caller, reads no cookie, and the route is
    // outside `requireSession`. Never widen CORS to any other route — the rest are session-scoped,
    // and `Allow-Origin: *` cannot carry credentials anyway.
    c.header('Access-Control-Allow-Origin', '*');
    return c.json(jwks);
  });

  /**
   * CORS preflight for the JWKS route only.
   *
   * A cross-origin verifier fetching JSON with no custom headers sends a "simple request" and needs
   * no preflight, so this exists for the awkward-but-real case of a client that adds one (an
   * `Accept` beyond the safelisted values, a tracing header). Scoped to this exact path so the
   * blanket `app.notFound` keeps answering every other OPTIONS with no CORS headers at all, which is
   * what makes the JSON content-type requirement in `guardStateChanging` load-bearing.
   */
  app.options('/.well-known/jwks.json', (c) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    // Echo whatever headers the preflight asks about — that is the entire point of this route (a
    // preflight only fires when a request carries non-safelisted headers, so answering it without
    // allowing them would fail exactly the clients it exists for). Harmless to grant: the resource
    // is a public GET of public key material, and no header changes what it returns.
    const requested = c.req.header('Access-Control-Request-Headers');
    if (requested) c.header('Access-Control-Allow-Headers', requested);
    c.header('Access-Control-Max-Age', '86400');
    return c.body(null, 204);
  });

  // -------------------------------------------------------------------------
  // profile
  // -------------------------------------------------------------------------

  app.get('/profile', requireSession, async (c) => {
    const profile = await getProfileOrEmpty(c.env.DB, c.get('userId'));
    return c.json(profile);
  });

  app.put('/profile', requireSession, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    if (typeof body !== 'object' || body === null) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { firstName, lastName } = body as Record<string, unknown>;
    if (!isAcceptableName(firstName) || !isAcceptableName(lastName)) {
      // Empty / whitespace-only / missing / oversized names are rejected here — this is the
      // enforcement point for "no default placeholder name" on certificates — and so are names
      // carrying control or bidi-override characters, which would otherwise be locked in and then
      // published by the public verify route (see FORBIDDEN_NAME_CHARS).
      return c.json({ error: 'invalid_name' }, 400);
    }

    const result = await upsertProfile(c.env.DB, c.get('userId'), {
      firstName: normalizeName(firstName),
      lastName: normalizeName(lastName),
    });
    if (!result.ok) {
      return c.json({ error: 'name_locked' }, 409);
    }
    return c.json({
      firstName: result.profile.first_name ?? '',
      lastName: result.profile.last_name ?? '',
      nameLocked: Boolean(result.profile.name_locked_at),
    });
  });

  // -------------------------------------------------------------------------
  // progress
  // -------------------------------------------------------------------------

  async function currentProgress(env: Env, userId: string) {
    const [readLessons, quizMasks, lastPositionRow, epoch] = await Promise.all([
      listLessonProgress(env.DB, userId),
      listQuizProgress(env.DB, userId),
      getLastPosition(env.DB, userId),
      getProgressEpoch(env.DB, userId),
    ]);
    return {
      readLessons,
      quizMasks,
      lastPosition: lastPositionRow
        ? { lessonId: lastPositionRow.lesson_id, updatedAt: lastPositionRow.updated_at }
        : null,
      // The client stores this and echoes it back on every sync. See the epoch discussion in
      // store.ts (getProgressEpoch) for why a union-merge protocol needs it to express a reset.
      epoch,
    };
  }

  app.get('/progress', requireSession, async (c) => {
    return c.json(await currentProgress(c.env, c.get('userId')));
  });

  app.post('/progress/sync', requireSession, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    if (typeof body !== 'object' || body === null) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { readLessons, quizMasks, lastPosition } = body as Record<string, unknown>;

    // --- validate shapes + cap sizes (defense in depth: fixed 135-lesson/12-track
    // curriculum, so anything bigger than these caps is malformed or abusive) ---
    if (readLessons !== undefined) {
      const ok =
        Array.isArray(readLessons) &&
        readLessons.length <= MAX_LESSON_IDS &&
        readLessons.every((id) => isNonEmptyShortString(id, 100));
      if (!ok) return c.json({ error: 'invalid_read_lessons' }, 400);
    }

    let quizEntries: Array<[string, number]> = [];
    if (quizMasks !== undefined) {
      if (typeof quizMasks !== 'object' || quizMasks === null || Array.isArray(quizMasks)) {
        return c.json({ error: 'invalid_quiz_masks' }, 400);
      }
      // Check the key COUNT before materialising entries: `Object.entries(...).map(...)` on a body
      // with a million keys allocates two million-element arrays before we would ever reach the cap
      // below, which turns a 400 into real CPU and memory spent on a malformed request.
      if (Object.keys(quizMasks as Record<string, unknown>).length > MAX_TRACK_IDS) {
        return c.json({ error: 'invalid_quiz_masks' }, 400);
      }
      quizEntries = Object.entries(quizMasks as Record<string, unknown>).map(([k, v]) => [k, v as number]);
      const ok =
        quizEntries.length <= MAX_TRACK_IDS &&
        quizEntries.every(
          ([trackId, mask]) =>
            isNonEmptyShortString(trackId, 50) &&
            typeof mask === 'number' &&
            Number.isInteger(mask) &&
            mask >= 0 &&
            mask <= 0xffffffff
        );
      if (!ok) return c.json({ error: 'invalid_quiz_masks' }, 400);
    }

    let lastPositionInput: { lessonId: string; updatedAt: string } | null = null;
    if (lastPosition !== undefined && lastPosition !== null) {
      const lp = lastPosition as Record<string, unknown>;
      const validShape =
        typeof lastPosition === 'object' &&
        isNonEmptyShortString(lp.lessonId, 100) &&
        typeof lp.updatedAt === 'string' &&
        !Number.isNaN(Date.parse(lp.updatedAt));
      if (!validShape) return c.json({ error: 'invalid_last_position' }, 400);
      // Last-position is the one last-write-wins field, and `setLastPosition` decides the winner
      // with a STRING comparison (`WHERE excluded.updated_at >= ...`). That is only correct for
      // canonical ISO-8601 UTC, and merely being `Date.parse`-able is far weaker than that: an
      // accepted-but-non-ISO value like "Sat Jan 01 2050" sorts above every real timestamp
      // (because "S" > "2") and would silently no-op every future write forever, wedging the
      // learner's saved place and echoing the garbage back from GET /progress. So: re-serialise to
      // canonical ISO ourselves rather than storing the caller's string, and refuse a timestamp
      // implausibly far in the future — a client clock may legitimately be a few minutes off, but
      // a year off is either broken or deliberate.
      const parsedMs = Date.parse(lp.updatedAt as string);
      if (parsedMs > Date.now() + POSITION_CLOCK_SKEW_MS) {
        return c.json({ error: 'invalid_last_position' }, 400);
      }
      lastPositionInput = {
        lessonId: lp.lessonId as string,
        updatedAt: new Date(parsedMs).toISOString(),
      };
    }

    // --- apply union merges ---
    const userId = c.get('userId');
    const nowIso = new Date().toISOString();

    // --- the reset gate ---
    //
    // A device presents the epoch it last saw. If it is behind the server's, this payload was
    // composed BEFORE a reset that device has not learned about yet, so merging it would resurrect
    // exactly the progress the learner asked to delete — on a different machine, hours later, which
    // is what made the old behaviour so baffling. Drop the payload and hand back canonical truth
    // plus the current epoch; the client adopts both and converges.
    //
    // A MISSING epoch is tolerated ONLY while the learner has never reset (serverEpoch === 0). That
    // narrowness is the whole point, and the earlier "missing means current" rule was too generous:
    // an epoch-less payload is by definition from JS predating this protocol, and once a learner HAS
    // reset, accepting it re-unions every id the reset deleted — which is exactly the bug migration
    // 0053 exists to fix, reappearing via any second device still running cached pre-epoch
    // functions.min.js. Since the live-update toast is best-effort, that is a real user, not a
    // hypothetical attacker. At epoch 0 there is nothing a union could resurrect, so old clients
    // keep syncing normally until the first reset; after that they are told the new epoch and adopt
    // it. A client claiming a HIGHER epoch than the server's is treated as stale, since trusting it
    // would let a caller opt out of every future reset by sending a large number.
    const clientEpochRaw = (body as Record<string, unknown>).epoch;
    const serverEpoch = await getProgressEpoch(c.env.DB, userId);
    if (clientEpochRaw !== undefined || serverEpoch !== 0) {
      const clientEpoch =
        typeof clientEpochRaw === 'number' && Number.isInteger(clientEpochRaw) && clientEpochRaw >= 0
          ? clientEpochRaw
          : -1;
      if (clientEpoch !== serverEpoch) {
        return c.json({ ...(await currentProgress(c.env, userId)), rejected: 'stale_epoch' });
      }
    }

    // --- bound total stored rows ---
    //
    // Applied AFTER the epoch gate (a stale payload is dropped before it can count against anyone)
    // and only when there is something to insert. See `countLessonProgress` for why a total cap is
    // the only bound available: the server holds no copy of the curriculum, so junk ids cannot be
    // rejected on content, and an authenticated caller could otherwise write 500 rows per request
    // into a database shared with the sister Lab app. The caps sit far above the real curriculum
    // (135 lessons, 12 tracks), so no learner can reach them.
    if (Array.isArray(readLessons) && readLessons.length > 0) {
      const existing = await countLessonProgress(c.env.DB, userId);
      if (existing + readLessons.length > MAX_STORED_LESSON_ROWS) {
        return c.json({ error: 'progress_limit_reached' }, 409);
      }
    }
    if (quizEntries.length > 0) {
      const existingTracks = await countQuizProgress(c.env.DB, userId);
      if (existingTracks + quizEntries.length > MAX_STORED_TRACK_ROWS) {
        return c.json({ error: 'progress_limit_reached' }, 409);
      }
    }

    // Every write below re-checks `serverEpoch` INSIDE its own statement. The gate above is a read
    // followed by several awaited round trips, so a `POST /progress/reset` from another device can
    // land in between — and the union writes would then resurrect the deleted rows stamped at the
    // NEW epoch, where no later sync could ever detect or correct them. Re-checking in the statement
    // means a raced write simply does nothing; the client is told the truth on its next sync.
    if (Array.isArray(readLessons) && readLessons.length > 0) {
      await unionLessonProgress(c.env.DB, userId, readLessons as string[], nowIso, serverEpoch);
    }
    // One batched round-trip for all tracks, not one awaited statement per track —
    // the union/OR semantics are per-row and unchanged, but a full-curriculum sync
    // no longer costs up to MAX_TRACK_IDS serial D1 hops.
    await unionQuizMasks(c.env.DB, userId, quizEntries, nowIso, serverEpoch);
    if (lastPositionInput) {
      await setLastPosition(
        c.env.DB,
        userId,
        lastPositionInput.lessonId,
        lastPositionInput.updatedAt,
        serverEpoch
      );
    }

    // Return the new canonical merged truth so the caller can overwrite its local cache.
    return c.json(await currentProgress(c.env, userId));
  });

  /**
   * Deletes progress — the channel the union-merge sync cannot express.
   *
   * `{ scope: 'all' }` clears everything. `{ scope: 'track', lessonIds, trackIds }` clears just the
   * listed lessons and quiz masks; the id lists come from the client because the curriculum mapping
   * lives in the front end and the server has never held a copy (see `deleteLessonProgress`).
   *
   * Either way the epoch is bumped, which is what makes the reset stick across devices rather than
   * being quietly re-unioned by the next device to sync. Bumping even for a track-scoped reset is
   * deliberate: the epoch is per-learner, so a stale device also forgoes contributing unsynced
   * progress for other tracks that one time. That is a re-readable page versus a reset that does
   * not hold — see migration 0053's header for the full trade.
   */
  app.post('/progress/reset', requireSession, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    if (typeof body !== 'object' || body === null) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { scope, lessonIds, trackIds } = body as Record<string, unknown>;
    const userId = c.get('userId');

    if (scope !== 'all' && scope !== 'track') {
      return c.json({ error: 'invalid_scope' }, 400);
    }
    if (scope === 'track') {
      const lessonsOk =
        lessonIds === undefined ||
        (Array.isArray(lessonIds) &&
          lessonIds.length <= MAX_LESSON_IDS &&
          lessonIds.every((id) => isNonEmptyShortString(id, 100)));
      const tracksOk =
        trackIds === undefined ||
        (Array.isArray(trackIds) &&
          trackIds.length <= MAX_TRACK_IDS &&
          trackIds.every((id) => isNonEmptyShortString(id, 50)));
      if (!lessonsOk || !tracksOk) {
        return c.json({ error: 'invalid_reset_scope' }, 400);
      }
    }

    // Throttle before ANY write, including the epoch bump. This is the one authenticated write on
    // this Worker with no cap of its own (audit finding R22-W-08) — see
    // MIN_PROGRESS_RESET_INTERVAL_MS in store.ts for why it is an interval rather than the daily
    // cap the exam and certificate routes use, why ten seconds, and the one legitimate case it can
    // refuse. Deliberately answered with a bare `rate_limited` and no `scope`: `describeApiError`
    // in academy-auth.js gives `scope:'account'` exam-specific wording ("you have used all 3 of
    // your final-exam attempts"), which would be nonsense on a progress reset. With no scope it
    // renders the generic "Too many attempts — please wait a bit and try again."
    const retryAfterReset = progressResetRetryAfterSeconds(
      await getLastProgressResetAt(c.env.DB, userId),
      Date.now()
    );
    if (retryAfterReset !== null) {
      return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(retryAfterReset) });
    }

    // The epoch bump comes BEFORE the deletes, and the order is load-bearing. The in-statement
    // guard on every merge write compares against the CURRENT epoch — so with delete-then-bump, a
    // sync that passed the route pre-check at the old epoch and is mid-flight through its own
    // round trips could land its writes in the gap after our deletes and before our bump, where
    // the old epoch is still current: the guard passes, the deleted rows come back, and the bump
    // then stamps the world as if that never happened — the unrecoverable state this machinery
    // exists to prevent. Bump-first closes both halves: an old-epoch write executing after the
    // bump fails the in-statement guard, and one that squeaked in before it is swept by the
    // deletes that follow.
    await bumpProgressEpoch(c.env.DB, userId);

    if (scope === 'all') {
      await deleteLessonProgress(c.env.DB, userId);
      await deleteQuizProgress(c.env.DB, userId);
      await clearLastPosition(c.env.DB, userId);
    } else {
      if (Array.isArray(lessonIds)) {
        await deleteLessonProgress(c.env.DB, userId, lessonIds as string[]);
      }
      if (Array.isArray(trackIds)) {
        await deleteQuizProgress(c.env.DB, userId, trackIds as string[]);
      }
      // A track reset also drops the saved position, which may well be inside the track that just
      // got cleared — leaving it would send the learner straight back to a lesson they reset.
      await clearLastPosition(c.env.DB, userId);
    }

    return c.json(await currentProgress(c.env, userId));
  });

  // -------------------------------------------------------------------------
  // exam attempts
  // -------------------------------------------------------------------------

  app.post('/exam/attempts', requireSession, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    if (typeof body !== 'object' || body === null) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { answers } = body as Record<string, unknown>;

    // The client submits its CHOICES, not a score. A real sitting answers exactly
    // EXAM_QUESTION_COUNT distinct pool questions; each entry is a known question id plus the
    // ORIGINAL (pre-shuffle) index of the option the learner picked. The server grades these against
    // its own answer key (see ./exam) — a client can no longer assert a score at all.
    if (!Array.isArray(answers) || answers.length !== EXAM_QUESTION_COUNT) {
      return c.json({ error: 'invalid_answers' }, 400);
    }
    const parsed: SubmittedAnswer[] = [];
    const seenIds = new Set<string>();
    for (const entry of answers) {
      if (typeof entry !== 'object' || entry === null) {
        return c.json({ error: 'invalid_answers' }, 400);
      }
      const { id, choice } = entry as Record<string, unknown>;
      if (
        !isNonEmptyShortString(id, 50) ||
        !isKnownQuestion(id) ||
        typeof choice !== 'number' ||
        !Number.isInteger(choice) ||
        choice < 0 ||
        choice > 3
      ) {
        return c.json({ error: 'invalid_answers' }, 400);
      }
      if (seenIds.has(id)) {
        return c.json({ error: 'invalid_answers' }, 400);
      }
      seenIds.add(id);
      parsed.push({ id, choice });
    }

    // ...and the sitting must be shaped like a draw our own exam panel would have produced: at
    // least the guaranteed number of questions from every track. Everything above validates the
    // entries one at a time; this is the only check on the draw AS A WHOLE. See `isWellFormedDraw`
    // for what this does and does not buy — in particular that it is not an anti-cheating measure,
    // but the thing that makes the stored `question_ids_json` mean what the UI told the learner it
    // would mean.
    if (!isWellFormedDraw(parsed.map((a) => a.id))) {
      return c.json({ error: 'invalid_answers' }, 400);
    }

    // Authoritative grading. `gradeExam` throws `unknown_question` only if an id passed the
    // isKnownQuestion check above and then failed inside — i.e. never, under a consistent key — but
    // it is caught so a future key/pool drift degrades to a clean 400 rather than a 500.
    let graded;
    try {
      graded = gradeExam(parsed);
    } catch {
      return c.json({ error: 'invalid_answers' }, 400);
    }
    const { score, questionIds } = graded;
    const passed = graded.passed;

    const userId = c.get('userId');

    // Rate limit, both halves — see MAX_EXAM_ATTEMPTS_PER_DAY for why three and why per network too.
    //
    // ONE window start is computed here and used for every count, the scrub and both "when can I try
    // again?" lookups. Recomputing `abuseWindowStartIso()` per query would drift by milliseconds
    // between them, which is harmless for a count but not for the scrub: erasing keys against a
    // window start LATER than the one the count used deletes rows the count would still have seen.
    const windowStart = abuseWindowStartIso();
    const ipHash = await hashClientIp(
      clientIpFromHeader(c.req.header('CF-Connecting-IP')),
      c.env.EXAM_IP_HASH_PEPPER
    );

    // Account first: it is the limit most callers hit, and the one whose message needs no
    // explanation. Only if the account has room do we ask about the network, so a learner with
    // nothing left of their own is never told about their neighbours' usage.
    const attemptsToday = await countExamAttemptsSince(c.env.DB, userId, windowStart);
    if (attemptsToday >= MAX_EXAM_ATTEMPTS_PER_DAY) {
      const oldest = await oldestExamAttemptSince(c.env.DB, { userId }, windowStart);
      return rateLimitResponse(c, 'account', MAX_EXAM_ATTEMPTS_PER_DAY, nextAttemptIso(oldest));
    }

    const attemptsFromIp = await countExamAttemptsByIpSince(c.env.DB, ipHash, windowStart);
    if (attemptsFromIp >= MAX_EXAM_ATTEMPTS_PER_IP_PER_DAY) {
      const oldest = await oldestExamAttemptSince(c.env.DB, { ipHash }, windowStart);
      return rateLimitResponse(
        c,
        'network',
        MAX_EXAM_ATTEMPTS_PER_IP_PER_DAY,
        nextAttemptIso(oldest)
      );
    }

    // score/passed are the SERVER's, computed by gradeExam above from the submitted choices — the
    // caller never sends them. `correct`/`total` go back so the browser can render "X/50" without
    // re-deriving it from the percentage (which rounds and could disagree at the boundary).
    const id = crypto.randomUUID();
    const takenAt = new Date().toISOString();
    const questionIdsJson = JSON.stringify(questionIds);

    await insertExamAttempt(c.env.DB, {
      id,
      userId,
      score,
      passed,
      takenAt,
      questionIdsJson,
      ipHash,
    });

    // Erase network identifiers that have aged out of the counting window (see the store helper).
    // Deliberately AFTER the insert and off the response path: this is housekeeping, and an attempt
    // the learner just sat and the server just graded must not fail because a cleanup UPDATE did.
    // `waitUntil` keeps it out of their latency; the try/catch is for runtimes where it is absent,
    // and the `.catch` swallows an async D1 blip — the next submission retries the same scrub.
    try {
      c.executionCtx.waitUntil(
        scrubExamAttemptIpHashesBefore(c.env.DB, windowStart).catch(() => undefined)
      );
    } catch {
      /* no execution context (tests, some runtimes): skip the sweep, next attempt will do it */
    }

    return c.json(
      {
        id,
        score,
        passed,
        correct: graded.correct,
        total: graded.total,
        takenAt,
        questionIds,
        // Count this attempt itself, so the client can say "2 of 3 used" without a second round trip
        // or an off-by-one of its own.
        remainingToday: Math.max(0, MAX_EXAM_ATTEMPTS_PER_DAY - (attemptsToday + 1)),
      },
      201
    );
  });

  /**
   * The learner's own attempt history, plus where they stand against the limits.
   *
   * An object rather than the bare array this used to return: the history is only half of what the
   * exam panel has to show, and "how many attempts do I have left, and when do I get another?" is
   * not derivable from the list — the network half of the limit is not counted per user and could
   * never be. Reshaping was free: nothing consumed this endpoint before.
   *
   * WHAT THE NETWORK FIELD DELIBERATELY DOES NOT SAY: it reports whether this network is currently
   * out of attempts, and if so when that ends — not how many have been used, and never by whom.
   * A running count of a shared connection's usage would be telling every learner behind a NAT
   * something about the others behind it, to no benefit; a single bit that only appears when it
   * actually affects this learner is all the UI needs to stay honest.
   */
  app.get('/exam/attempts', requireSession, async (c) => {
    const userId = c.get('userId');
    const windowStart = abuseWindowStartIso();
    const rows = await listExamAttempts(c.env.DB, userId);

    const usedToday = await countExamAttemptsSince(c.env.DB, userId, windowStart);
    const oldestOwn = await oldestExamAttemptSince(c.env.DB, { userId }, windowStart);

    const ipHash = await hashClientIp(
      clientIpFromHeader(c.req.header('CF-Connecting-IP')),
      c.env.EXAM_IP_HASH_PEPPER
    );
    const usedFromIp = await countExamAttemptsByIpSince(c.env.DB, ipHash, windowStart);
    const networkExhausted = usedFromIp >= MAX_EXAM_ATTEMPTS_PER_IP_PER_DAY;
    const oldestFromIp = networkExhausted
      ? await oldestExamAttemptSince(c.env.DB, { ipHash }, windowStart)
      : null;

    return c.json({
      attempts: rows.map((r) => {
        const questionIds = JSON.parse(r.question_ids_json) as string[];
        return {
          id: r.id,
          score: r.score,
          passed: Boolean(r.passed),
          takenAt: r.taken_at,
          questionIds,
          // Derived, not stored: only the percentage is a column. Exact for every real sitting
          // (50 questions ⇒ each answer is worth a whole 2%), and the total is the length of the
          // question list the attempt was actually scored against, never today's exam length.
          total: questionIds.length,
          correct: Math.round((r.score / 100) * questionIds.length),
        };
      }),
      limits: {
        perDay: MAX_EXAM_ATTEMPTS_PER_DAY,
        windowHours: ABUSE_WINDOW_MS / 3600000,
        usedToday,
        remaining: Math.max(0, MAX_EXAM_ATTEMPTS_PER_DAY - usedToday),
        nextAttemptAt:
          usedToday >= MAX_EXAM_ATTEMPTS_PER_DAY ? nextAttemptIso(oldestOwn) : null,
        network: {
          exhausted: networkExhausted,
          perDay: MAX_EXAM_ATTEMPTS_PER_IP_PER_DAY,
          nextAttemptAt: networkExhausted ? nextAttemptIso(oldestFromIp) : null,
        },
      },
    });
  });

  // -------------------------------------------------------------------------
  // certificates
  // -------------------------------------------------------------------------

  app.post('/certificates/issue', requireSession, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    if (typeof body !== 'object' || body === null) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { attemptId } = body as Record<string, unknown>;
    if (!isNonEmptyShortString(attemptId, 100)) {
      return c.json({ error: 'invalid_attempt_id' }, 400);
    }

    const userId = c.get('userId');

    // Idempotency short-circuit, FIRST. Issuance is keyed on UNIQUE(attempt_id), so a
    // repeat call for an already-certified attempt can only ever return the stored
    // row. Checking that up front means the re-issue path (a retry, a double-click, a
    // learner re-downloading) costs exactly one SELECT — where it used to sign a fresh
    // ES256 JWT and list every certificate the user owns before discovering the insert
    // was a no-op and throwing all that work away.
    const existing = await getCertificateByAttemptId(c.env.DB, attemptId);
    if (existing) {
      if (existing.user_id !== userId) {
        // Someone else's attempt id. Same 404 as an unknown id — never confirm that a
        // guessed attempt id exists under a different account.
        return c.json({ error: 'attempt_not_found' }, 404);
      }
      return c.json({
        serial: existing.serial,
        jwt: existing.jwt,
        holderName: existing.holder_name,
        score: existing.score,
        issuedAt: existing.issued_at,
        isBest: Boolean(existing.is_best),
      });
    }

    // Abuse backstop (see MAX_CERTIFICATES_PER_DAY). Checked AFTER the idempotency
    // short-circuit on purpose: re-fetching a certificate you already own is not new
    // work and must never be throttled — only genuinely new issuances count.
    const certsToday = await countCertificatesSince(c.env.DB, userId, abuseWindowStartIso());
    if (certsToday >= MAX_CERTIFICATES_PER_DAY) {
      return c.json({ error: 'rate_limited' }, 429);
    }

    const attempt = await getExamAttemptById(c.env.DB, attemptId);
    if (!attempt || attempt.user_id !== userId) {
      return c.json({ error: 'attempt_not_found' }, 404);
    }
    if (!attempt.passed) {
      return c.json({ error: 'attempt_not_passed' }, 422);
    }

    const profile = await getProfile(c.env.DB, userId);
    const firstName = profile?.first_name?.trim() ?? '';
    const lastName = profile?.last_name?.trim() ?? '';
    if (!firstName || !lastName) {
      // Frontend uses this error code to redirect into the profile-completion step.
      return c.json({ error: 'profile_incomplete' }, 422);
    }

    const nowIso = new Date().toISOString();
    // The name printed on the certificate. NOT locked yet — the lock happens only after the row is
    // safely inserted, further down. Locking first was a small but unfixable trap: signing or the
    // insert can still fail (a malformed ACADEMY_PRIVATE_JWK, a D1 blip, a serial collision), and a
    // learner left name-locked with zero certificates has no way to correct their name from any UI
    // on either site. An already-locked profile is respected here, since `getProfile` returns
    // whatever is stored either way.
    const holderName = `${firstName} ${lastName}`;

    const serial = generateCertificateSerial();
    const iatSec = Math.floor(Date.now() / 1000);
    const expSec = iatSec + 10 * 365 * 24 * 60 * 60; // 10-year validity for the JWT artifact

    const jwt = await signCertificateJwt(c.env, {
      iat: iatSec,
      exp: expSec,
      jti: serial,
      name: holderName,
      score: attempt.score,
    });

    // Best-effort "is this a new best" guess used only if this call is the one that
    // actually performs the insert (a concurrent retry of the same attemptId is a
    // no-op below and its is_best flag is irrelevant — we always trust whatever
    // landed in the DB, read back right after). Aggregated in SQL: listCertificates()
    // is LIMIT-ed, so reducing over it would silently miss the true maximum.
    const currentBest = await getBestCertificateScore(c.env.DB, userId);
    const guessIsBest = attempt.score >= currentBest;

    const row = await insertCertificateIfAbsent(c.env.DB, {
      id: crypto.randomUUID(),
      userId,
      attemptId,
      serial,
      holderName,
      score: attempt.score,
      jwt,
      isBest: guessIsBest,
      issuedAt: nowIso,
    });

    if (!row) {
      return c.json({ error: 'issue_failed' }, 500);
    }

    // NOW lock the name — the certificate exists, so the thing the lock protects is real. No-op if
    // already locked. See the comment where `holderName` is built for why this is not done earlier.
    //
    // The exact printed name is passed so the lock pins THAT, not whatever the profile says by the
    // time we get here: `PUT /profile` is still accepted during every await above (the lock is what
    // stops it, and it does not exist yet), so a rename landing mid-issuance would otherwise leave
    // the locked profile permanently disagreeing with a public certificate. See
    // lockProfileNameIfAbsent.
    await lockProfileNameIfAbsent(c.env.DB, userId, nowIso, { firstName, lastName });

    // Settle which certificate is "best" by recomputing from the stored rows rather than acting on
    // the pre-insert guess. Two DIFFERENT attempts issued concurrently would each read the same
    // `currentBest`, each conclude it had won, and each demote the other — leaving the learner with
    // no certificate flagged best at all, and no badge in the history panel. A recompute is
    // idempotent and self-correcting, so whichever request runs it last leaves a consistent answer.
    await recomputeBestCertificate(c.env.DB, userId);
    const settled = (await getCertificateByAttemptId(c.env.DB, attemptId)) ?? row;

    return c.json({
      serial: settled.serial,
      jwt: settled.jwt,
      holderName: settled.holder_name,
      score: settled.score,
      issuedAt: settled.issued_at,
      isBest: Boolean(settled.is_best),
    });
  });

  app.get('/certificates', requireSession, async (c) => {
    const rows = await listCertificates(c.env.DB, c.get('userId'));
    // Raw JWT deliberately omitted here to keep list payloads small — see the
    // dedicated /:serial/jwt download endpoint below for the signed artifact.
    return c.json(
      rows.map((r) => ({
        serial: r.serial,
        holderName: r.holder_name,
        score: r.score,
        issuedAt: r.issued_at,
        isBest: Boolean(r.is_best),
      }))
    );
  });

  // Public verify-by-serial lookup — no session required, no cookie read. Registered
  // before the owner-checked "/:serial/jwt" route below purely for readability; Hono's
  // router matches the literal "verify" segment correctly regardless of order.
  //
  // RESPONSE CONTRACT — the three cases are deliberately distinguishable, because a
  // verifier must never be told "not found" when what actually happened is "we
  // couldn't look it up":
  //
  //   200 {valid:true,  ...}  — authoritative: this certificate exists, here it is.
  //   200 {valid:false}       — authoritative: no certificate has that serial.
  //   5xx {error:"..."}       — NOT authoritative: the lookup itself failed.
  //
  // The third case is what app.onError below produces: any throw out of this handler
  // (a D1 outage, a missing table) becomes a 500 with an `error` field and no `valid`
  // field at all, and is logged. Nothing here catches and downgrades a failure into a
  // cheerful `{valid:false}` — that is the bug this contract exists to prevent.
  // Callers must branch on `response.ok` FIRST and only then read `valid`.
  app.get('/certificates/verify/:serial', async (c) => {
    // Try what the human typed VERBATIM, then the canonicalised form (case, hyphens,
    // spaces, 0/O and 1/I/L confusions). Both arms are needed: a certificate minted
    // before the `IA-…` format keeps its original serial forever — it is the `jti`
    // inside an already-signed JWT — and canonicalising is exactly what makes such a
    // serial unfindable. See certificateSerialLookupCandidates for the full reasoning.
    // Input that can be no format we have ever minted yields no candidates and is
    // answered as an authoritative "no such certificate" without touching the database.
    const candidates = certificateSerialLookupCandidates(c.req.param('serial'));
    let row = null;
    for (const candidate of candidates) {
      row = await getCertificateBySerial(c.env.DB, candidate);
      if (row) break;
    }
    if (!row) {
      // Same 200 shape whether found or not — simplest for the frontend, and for a
      // public credential-verification endpoint the existence-leak concern is minor
      // compared to an auth endpoint (and serials are unguessable regardless; see
      // the entropy note on generateCertificateSerial).
      return c.json({ valid: false });
    }
    return c.json({
      valid: true,
      serial: row.serial,
      holderName: row.holder_name,
      score: row.score,
      issuedAt: row.issued_at,
    });
  });

  // Explicit "download the signed artifact" affordance: session-gated, owner-checked.
  app.get('/certificates/:serial/jwt', requireSession, async (c) => {
    // Same two-arm lookup as the public verifier above, and for the same reason: the
    // holder of a legacy-serial certificate must still be able to download their own
    // signed artifact. The owner check below is unchanged and still decides access.
    const candidates = certificateSerialLookupCandidates(c.req.param('serial'));
    let row = null;
    for (const candidate of candidates) {
      row = await getCertificateBySerial(c.env.DB, candidate);
      if (row) break;
    }
    if (!row || row.user_id !== c.get('userId')) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json({ serial: row.serial, jwt: row.jwt });
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  // Every unhandled throw lands here: logged, and answered with a non-200 carrying an
  // `error` code. Load-bearing for the verify-by-serial contract above — see it.
  app.onError((err, c) => {
    console.error('academy api error', err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

export type AcademyApp = ReturnType<typeof createApp>;

// Hono app mounted at /api/academy/* by src/worker.ts.
//
// Auth: every route requires the shared SSO session cookie EXCEPT two public ones
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
//
// A real per-IP/per-session limiter would need a Durable Object or KV
// (in-memory-per-isolate counters aren't reliable on Workers, since concurrent
// requests can land on different isolates). That remains disproportionate for this
// Worker's write surface; the SQL guards are the right size for the actual risk.

import { Hono, type MiddlewareHandler } from 'hono';
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
  insertExamAttempt,
  listExamAttempts,
  countExamAttemptsSince,
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
} from './store';
import {
  signCertificateJwt,
  getPublicJwks,
  generateCertificateSerial,
  normalizeCertificateSerial,
} from './certs';

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
 * request (MAX_LESSON_IDS / MAX_TRACK_IDS above). Both sit far above the real curriculum — 133
 * lessons, 12 tracks — so no learner can reach them, including one who re-reads everything. See
 * `countLessonProgress` in store.ts for why a total bound is the only one available.
 */
const MAX_STORED_LESSON_ROWS = 400;
const MAX_STORED_TRACK_ROWS = 40;

/**
 * How far ahead of our own clock a client-supplied `lastPosition.updatedAt` may be. A device's clock
 * being a few minutes out is ordinary; being a year out is either broken or an attempt to pin the
 * saved position forever, since the merge is last-write-wins on this value.
 */
const POSITION_CLOCK_SKEW_MS = 10 * 60 * 1000;

/**
 * The exam's shape, mirrored from `ACAD_EXAM_POOL`'s draw in js/academy-labs.js (`N = 50`,
 * `PASS = 0.8`). KEEP IN SYNC with that file — if the exam ever changes length or pass mark, these
 * must move with it or every genuine attempt starts 400ing.
 */
const EXAM_QUESTION_COUNT = 50;
const EXAM_PASS_PERCENT = 80;

/**
 * The single question-id sentinel the client sends when claiming a pass that was earned on this
 * device before the learner had an account. KEEP IN SYNC with js/academy-labs.js.
 */
const LEGACY_LOCAL_PASS_SENTINEL = 'legacy-local-pass';

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
 * without this branch every state-changing call 403s on the *.workers.dev URL (the whole
 * pre-cutover staging plan, per wrangler.toml) and on http://localhost during local dev — the
 * exact "can't sign in locally" symptom this repo hit before.
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
 * Abuse backstops, NOT rate limits. Enforced with a single `SELECT COUNT(*)` over
 * the last 24 hours per user, so they are cheap, exact, and stateless (no DO, no
 * KV, no in-isolate counters that concurrency would defeat).
 *
 * What they are for: both guarded endpoints are authenticated INSERTs with no
 * natural bound, into a D1 instance SHARED with the sister Lab app — a single
 * scripted account could otherwise write rows until it degraded a database this
 * repo does not own. What they are NOT for: they will not stop a distributed or
 * multi-account attack, they don't limit read traffic, and they don't smooth
 * bursts. The numbers are set far above anything a real learner does (a 50-question
 * exam takes real time; a certificate is issued once per passed attempt and is
 * idempotent thereafter), so hitting one means something is wrong, not that
 * someone is studying hard.
 */
const MAX_EXAM_ATTEMPTS_PER_DAY = 20;
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

    // --- validate shapes + cap sizes (defense in depth: fixed 133-lesson/12-track
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
    // (133 lessons, 12 tracks), so no learner can reach them.
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

    if (scope === 'all') {
      await deleteLessonProgress(c.env.DB, userId);
      await deleteQuizProgress(c.env.DB, userId);
      await clearLastPosition(c.env.DB, userId);
    } else if (scope === 'track') {
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
      if (Array.isArray(lessonIds)) {
        await deleteLessonProgress(c.env.DB, userId, lessonIds as string[]);
      }
      if (Array.isArray(trackIds)) {
        await deleteQuizProgress(c.env.DB, userId, trackIds as string[]);
      }
      // A track reset also drops the saved position, which may well be inside the track that just
      // got cleared — leaving it would send the learner straight back to a lesson they reset.
      await clearLastPosition(c.env.DB, userId);
    } else {
      return c.json({ error: 'invalid_scope' }, 400);
    }

    await bumpProgressEpoch(c.env.DB, userId);
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
    const { score, passed, questionIds } = body as Record<string, unknown>;

    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100) {
      return c.json({ error: 'invalid_score' }, 400);
    }
    if (typeof passed !== 'boolean') {
      return c.json({ error: 'invalid_passed' }, 400);
    }
    // `passed` must AGREE with `score`, not be an independent assertion. Grading still happens in
    // the browser (see the note below), so this does not make the score trustworthy — but it does
    // close the specific absurdity of a stored, certificate-eligible attempt that says
    // `{score: 0, passed: true}`, and it means the one number a third party reads off /verify can
    // never contradict the pass mark printed beside it.
    if (passed !== score >= EXAM_PASS_PERCENT) {
      return c.json({ error: 'invalid_passed' }, 400);
    }
    if (
      !Array.isArray(questionIds) ||
      questionIds.length === 0 ||
      questionIds.length > 200 ||
      !questionIds.every((id) => isNonEmptyShortString(id, 50))
    ) {
      return c.json({ error: 'invalid_question_ids' }, 400);
    }
    // A real sitting answers exactly EXAM_QUESTION_COUNT distinct questions. The one legitimate
    // exception is the "claim the pass I earned on this device before I had an account" path, which
    // by construction has no question list to replay and sends a single sentinel id instead.
    const isLegacyClaim =
      questionIds.length === 1 && questionIds[0] === LEGACY_LOCAL_PASS_SENTINEL;
    if (!isLegacyClaim) {
      if (questionIds.length !== EXAM_QUESTION_COUNT) {
        return c.json({ error: 'invalid_question_ids' }, 400);
      }
      if (new Set(questionIds as string[]).size !== questionIds.length) {
        return c.json({ error: 'invalid_question_ids' }, 400);
      }
    }

    const userId = c.get('userId');

    // Abuse backstop (see MAX_EXAM_ATTEMPTS_PER_DAY): this is an authenticated,
    // unbounded INSERT into a database shared with the Lab app, so cap how many rows
    // one account can add per day. A learner who genuinely sat 20 fifty-question
    // exams in 24 hours is not who this rejects.
    const attemptsToday = await countExamAttemptsSince(c.env.DB, userId, abuseWindowStartIso());
    if (attemptsToday >= MAX_EXAM_ATTEMPTS_PER_DAY) {
      return c.json({ error: 'rate_limited' }, 429);
    }

    // NOTE (accepted limitation, not fixed here — out of scope per spec): the exam is
    // fully client-side simulated today (no server-side answer key exists in this
    // repo), so score/passed are trusted from the caller. A determined user could POST
    // a fabricated passing score. This mirrors the existing client-side-only exam's
    // risk posture; this endpoint just makes the (already-trusted) result durable
    // instead of inventing new server-side grading.
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
    });

    return c.json({ id, score, passed, takenAt, questionIds }, 201);
  });

  app.get('/exam/attempts', requireSession, async (c) => {
    const rows = await listExamAttempts(c.env.DB, c.get('userId'));
    return c.json(
      rows.map((r) => ({
        id: r.id,
        score: r.score,
        passed: Boolean(r.passed),
        takenAt: r.taken_at,
        questionIds: JSON.parse(r.question_ids_json) as string[],
      }))
    );
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
    await lockProfileNameIfAbsent(c.env.DB, userId, nowIso);

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
    // Canonicalise what the human typed (case, hyphens, spaces, 0/O and 1/I/L
    // confusions) before comparing against the stored canonical form. Input that
    // can't be one of our serials is answered as an authoritative "no such
    // certificate" without touching the database.
    const serial = normalizeCertificateSerial(c.req.param('serial'));
    if (!serial) {
      return c.json({ valid: false });
    }

    const row = await getCertificateBySerial(c.env.DB, serial);
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
    const serial = normalizeCertificateSerial(c.req.param('serial'));
    if (!serial) {
      return c.json({ error: 'not_found' }, 404);
    }
    const row = await getCertificateBySerial(c.env.DB, serial);
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

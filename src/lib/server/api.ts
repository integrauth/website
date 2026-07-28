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
//      state-changing method. Necessary because the session cookie is scoped to
//      *.integrauth.com, so ~30 sibling subdomains are SAME-SITE and SameSite=Lax
//      stops nothing between them.
//   2. Per-user daily caps on the two endpoints that INSERT unbounded rows into a
//      database shared with the Lab app. Explicitly a backstop, not a rate limiter
//      — see MAX_*_PER_DAY below.
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
  insertExamAttempt,
  listExamAttempts,
  countExamAttemptsSince,
  getExamAttemptById,
  insertCertificateIfAbsent,
  markOthersNotBest,
  listCertificates,
  getCertificateByAttemptId,
  getBestCertificateScore,
  countCertificatesSince,
  getCertificateBySerial,
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
 * The ONLY origins allowed to make a state-changing request to this API.
 *
 * Exact string match, no suffix matching, no regex: `https://integrauth.com.evil.com`
 * and `https://evilintegrauth.com` are the classic ways a "does it end with our
 * domain?" check gets defeated, and an allowlist of two literals cannot be fooled
 * that way. Note what is deliberately NOT here: lab.integrauth.com and the other
 * ~30 *.integrauth.com subdomains. They share the session cookie, which is exactly
 * why they must not be trusted to spend it — a stored XSS on any one of them would
 * otherwise be able to drive this API as the logged-in learner.
 */
export const ALLOWED_ORIGINS = ['https://integrauth.com', 'https://www.integrauth.com'] as const;

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
   * WHY THIS IS NEEDED AT ALL (the session cookie makes the usual reasoning wrong):
   * `__Secure-ia_session` is set with Domain=.integrauth.com, so every sibling
   * subdomain — all ~30 of the free-tool subdomains, the product apps, the demos —
   * is SAME-SITE as far as the browser is concerned. `SameSite=Lax` therefore does
   * NOT stop them: a page on any of those origins can issue a credentialed POST to
   * integrauth.com and the cookie rides along. And because Hono's `c.req.json()`
   * parses the body regardless of what Content-Type was declared, an attacker
   * didn't even need CORS — a form/fetch POST with `text/plain` is a CORS "simple
   * request" (no preflight to fail) whose body our handlers would happily read.
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
    if (!origin || !(ALLOWED_ORIGINS as readonly string[]).includes(origin)) {
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
    const token = parseSessionCookie(c.req.header('Cookie'));
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
    return c.json(jwks);
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
    if (
      !isNonEmptyShortString(firstName, MAX_NAME_LEN) ||
      !isNonEmptyShortString(lastName, MAX_NAME_LEN)
    ) {
      // Empty / whitespace-only / missing / oversized names are rejected here — this
      // is the enforcement point for "no default placeholder name" on certificates.
      return c.json({ error: 'invalid_name' }, 400);
    }

    const result = await upsertProfile(c.env.DB, c.get('userId'), {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
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
    const [readLessons, quizMasks, lastPositionRow] = await Promise.all([
      listLessonProgress(env.DB, userId),
      listQuizProgress(env.DB, userId),
      getLastPosition(env.DB, userId),
    ]);
    return {
      readLessons,
      quizMasks,
      lastPosition: lastPositionRow
        ? { lessonId: lastPositionRow.lesson_id, updatedAt: lastPositionRow.updated_at }
        : null,
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
      lastPositionInput = { lessonId: lp.lessonId as string, updatedAt: lp.updatedAt as string };
    }

    // --- apply union merges ---
    const userId = c.get('userId');
    const nowIso = new Date().toISOString();

    if (Array.isArray(readLessons) && readLessons.length > 0) {
      await unionLessonProgress(c.env.DB, userId, readLessons as string[], nowIso);
    }
    // One batched round-trip for all tracks, not one awaited statement per track —
    // the union/OR semantics are per-row and unchanged, but a full-curriculum sync
    // no longer costs up to MAX_TRACK_IDS serial D1 hops.
    await unionQuizMasks(c.env.DB, userId, quizEntries, nowIso);
    if (lastPositionInput) {
      await setLastPosition(c.env.DB, userId, lastPositionInput.lessonId, lastPositionInput.updatedAt);
    }

    // Return the new canonical merged truth so the caller can overwrite its local cache.
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
    if (
      !Array.isArray(questionIds) ||
      questionIds.length === 0 ||
      questionIds.length > 200 ||
      !questionIds.every((id) => isNonEmptyShortString(id, 50))
    ) {
      return c.json({ error: 'invalid_question_ids' }, 400);
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
    // Lock the name now (no-op if already locked) so it can never change after a
    // certificate has been minted with it printed on.
    const lockedProfile = await lockProfileNameIfAbsent(c.env.DB, userId, nowIso);
    const holderName = `${lockedProfile?.first_name ?? firstName} ${lockedProfile?.last_name ?? lastName}`.trim();

    const serial = generateCertificateSerial();
    const iatSec = Math.floor(Date.now() / 1000);
    const expSec = iatSec + 10 * 365 * 24 * 60 * 60; // 10-year validity for the JWT artifact

    const jwt = await signCertificateJwt(c.env, {
      sub: userId,
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

    if (row.is_best) {
      await markOthersNotBest(c.env.DB, userId, row.id);
    }

    return c.json({
      serial: row.serial,
      jwt: row.jwt,
      holderName: row.holder_name,
      score: row.score,
      issuedAt: row.issued_at,
      isBest: Boolean(row.is_best),
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

// Hono app mounted at /api/academy/* by src/worker.ts.
//
// Auth: every route requires the shared SSO session cookie EXCEPT the public
// certificate-verification lookup (GET /certificates/verify/:serial), which by
// design needs no cookie — anyone with a certificate's serial can confirm it's
// real. Security headers (incl. the strict JSON CSP) and `Cache-Control: no-store`
// are applied uniformly to every response by worker.ts, not here.
//
// Rate limiting: deliberately skipped. A real per-IP/per-session limiter needs a
// Durable Object or KV (in-memory-per-isolate counters aren't reliable on
// Workers, since concurrent requests can land on different isolates) — that's
// disproportionate for this Worker's small write surface today. Flagged as a
// follow-up, not built here.

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
  unionQuizMask,
  getLastPosition,
  setLastPosition,
  insertExamAttempt,
  listExamAttempts,
  getExamAttemptById,
  insertCertificateIfAbsent,
  markOthersNotBest,
  listCertificates,
  getCertificateBySerial,
  getUserById,
} from './store';
import { signCertificateJwt } from './certs';

interface Vars {
  userId: string;
  sessionId: string;
}

type AppEnv = { Bindings: Env; Variables: Vars };

const MAX_LESSON_IDS = 500;
const MAX_TRACK_IDS = 50;
const MAX_NAME_LEN = 80;

function isNonEmptyShortString(value: unknown, maxLen: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLen;
}

export function createApp() {
  const app = new Hono<AppEnv>().basePath('/api/academy');

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
    for (const [trackId, mask] of quizEntries) {
      await unionQuizMask(c.env.DB, userId, trackId, mask, nowIso);
    }
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
      userId: c.get('userId'),
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

    const user = await getUserById(c.env.DB, userId);
    const serial = crypto.randomUUID();
    const iatSec = Math.floor(Date.now() / 1000);
    const expSec = iatSec + 10 * 365 * 24 * 60 * 60; // 10-year validity for the JWT artifact

    const jwt = await signCertificateJwt(c.env, {
      sub: userId,
      iat: iatSec,
      exp: expSec,
      jti: serial,
      name: holderName,
      email: user?.email ?? '',
      score: attempt.score,
    });

    // Best-effort "is this a new best" guess used only if this call is the one that
    // actually performs the insert (a concurrent retry of the same attemptId is a
    // no-op below and its is_best flag is irrelevant — we always trust whatever
    // landed in the DB, read back right after).
    const existingCerts = await listCertificates(c.env.DB, userId);
    const currentBest = existingCerts.reduce((max, cert) => Math.max(max, cert.score), -1);
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
  app.get('/certificates/verify/:serial', async (c) => {
    const row = await getCertificateBySerial(c.env.DB, c.req.param('serial'));
    if (!row) {
      // Same 200 response shape whether found or not — simplest for the frontend,
      // and for a public credential-verification endpoint the existence-leak concern
      // is minor compared to an auth endpoint.
      return c.json({ valid: false });
    }
    return c.json({
      valid: true,
      holderName: row.holder_name,
      score: row.score,
      issuedAt: row.issued_at,
    });
  });

  // Explicit "download the signed artifact" affordance: session-gated, owner-checked.
  app.get('/certificates/:serial/jwt', requireSession, async (c) => {
    const row = await getCertificateBySerial(c.env.DB, c.req.param('serial'));
    if (!row || row.user_id !== c.get('userId')) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json({ serial: row.serial, jwt: row.jwt });
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error('academy api error', err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

export type AcademyApp = ReturnType<typeof createApp>;

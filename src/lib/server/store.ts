// Typed D1 accessors for THIS repo's own Academy tables: profiles,
// academy_lesson_progress, academy_quiz_progress, academy_last_position,
// academy_exam_attempts, academy_certificates. Every query is parameterized —
// never string-interpolate SQL here.
//
// `users` is Lab-owned and read-only from this repo (see session.ts for the
// equally read-only `sessions` access); `getUserById` below is the one place we
// touch it, purely to read an email for certificate claims.

export interface ProfileRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  name_locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  email_verified_at: string | null;
  created_at: string;
  status: string;
}

export interface ExamAttemptRow {
  id: string;
  user_id: string;
  score: number;
  passed: number; // 0 | 1 in SQLite
  taken_at: string;
  question_ids_json: string;
}

export interface CertificateRow {
  id: string;
  user_id: string;
  attempt_id: string;
  serial: string;
  holder_name: string;
  score: number;
  jwt: string;
  is_best: number; // 0 | 1 in SQLite
  issued_at: string;
}

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------

export async function getProfile(db: D1Database, userId: string): Promise<ProfileRow | null> {
  return db.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(userId).first<ProfileRow>();
}

/** Convenience for route handlers that just want a display-ready shape, never null. */
export async function getProfileOrEmpty(
  db: D1Database,
  userId: string
): Promise<{ firstName: string; lastName: string; nameLocked: boolean }> {
  const row = await getProfile(db, userId);
  return {
    firstName: row?.first_name ?? '',
    lastName: row?.last_name ?? '',
    nameLocked: Boolean(row?.name_locked_at),
  };
}

export type UpsertProfileResult =
  | { ok: true; profile: ProfileRow }
  | { ok: false; reason: 'locked' };

/**
 * Creates or updates the caller's profile name. Rejects (returns `{ok:false,
 * reason:'locked'}`) once `name_locked_at` has been set — the route layer maps
 * that to HTTP 409. The DB write itself also carries a `WHERE name_locked_at IS
 * NULL` guard so a lock racing in between our pre-check read and this write can
 * never be silently clobbered; we detect that race below and report it as locked
 * too, rather than falsely reporting success.
 */
export async function upsertProfile(
  db: D1Database,
  userId: string,
  input: { firstName: string; lastName: string }
): Promise<UpsertProfileResult> {
  const existing = await getProfile(db, userId);
  if (existing?.name_locked_at) {
    return { ok: false, reason: 'locked' };
  }

  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO profiles (user_id, first_name, last_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         updated_at = excluded.updated_at
       WHERE profiles.name_locked_at IS NULL`
    )
    .bind(userId, input.firstName, input.lastName, nowIso, nowIso)
    .run();

  const profile = await getProfile(db, userId);
  if (!profile) {
    // Unreachable in practice — the INSERT above always creates the row on first write.
    return { ok: false, reason: 'locked' };
  }
  if (
    profile.name_locked_at &&
    (profile.first_name !== input.firstName || profile.last_name !== input.lastName)
  ) {
    // A concurrent lock landed between our pre-check and the write; the WHERE guard
    // silently no-op'd the UPDATE. Surface it as locked instead of reporting success.
    return { ok: false, reason: 'locked' };
  }

  return { ok: true, profile };
}

/**
 * Compare-and-set: locks the profile's name (used at certificate-issuance time so
 * the name printed on a certificate can never change after the fact). No-ops if
 * already locked. Always re-reads and returns the resulting row so the caller sees
 * the actual (possibly pre-existing) lock timestamp and name.
 */
export async function lockProfileNameIfAbsent(
  db: D1Database,
  userId: string,
  nowIso: string
): Promise<ProfileRow | null> {
  await db
    .prepare('UPDATE profiles SET name_locked_at = ? WHERE user_id = ? AND name_locked_at IS NULL')
    .bind(nowIso, userId)
    .run();
  return getProfile(db, userId);
}

// ---------------------------------------------------------------------------
// academy_lesson_progress
// ---------------------------------------------------------------------------

/**
 * Unions a set of locally-read lesson ids into the server's record. `INSERT OR
 * IGNORE` makes each individual insert idempotent (first-read-wins timestamp per
 * lesson, matching "read" being a one-way flag); batched for efficiency.
 */
export async function unionLessonProgress(
  db: D1Database,
  userId: string,
  lessonIds: string[],
  nowIso: string
): Promise<void> {
  if (lessonIds.length === 0) return;
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO academy_lesson_progress (user_id, lesson_id, read_at) VALUES (?, ?, ?)'
  );
  await db.batch(lessonIds.map((lessonId) => stmt.bind(userId, lessonId, nowIso)));
}

export async function listLessonProgress(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT lesson_id FROM academy_lesson_progress WHERE user_id = ?')
    .bind(userId)
    .all<{ lesson_id: string }>();
  return results.map((r) => r.lesson_id);
}

// ---------------------------------------------------------------------------
// academy_quiz_progress
// ---------------------------------------------------------------------------

/**
 * Bitwise-ORs an incoming revealed-question mask into whatever is already stored
 * for this track, so two devices that each revealed different quiz questions
 * offline both end up reflected once synced (a reveal is one-way — never
 * un-reveal a question a device already knows was revealed elsewhere).
 */
export async function unionQuizMask(
  db: D1Database,
  userId: string,
  trackId: string,
  mask: number,
  nowIso: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO academy_quiz_progress (user_id, track_id, revealed_mask, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, track_id) DO UPDATE SET
         revealed_mask = revealed_mask | excluded.revealed_mask,
         updated_at = excluded.updated_at`
    )
    .bind(userId, trackId, mask, nowIso)
    .run();
}

export async function listQuizProgress(
  db: D1Database,
  userId: string
): Promise<Record<string, number>> {
  const { results } = await db
    .prepare('SELECT track_id, revealed_mask FROM academy_quiz_progress WHERE user_id = ?')
    .bind(userId)
    .all<{ track_id: string; revealed_mask: number }>();
  const out: Record<string, number> = {};
  for (const row of results) out[row.track_id] = row.revealed_mask;
  return out;
}

// ---------------------------------------------------------------------------
// academy_last_position
// ---------------------------------------------------------------------------

export interface LastPositionRow {
  lesson_id: string;
  updated_at: string;
}

/**
 * Upserts the caller's last-read lesson, but only if `updatedAtIso` is at least as
 * new as whatever is currently stored (last-write-wins by caller-supplied
 * timestamp, compared in SQL so it's atomic against a concurrent write). This lets
 * a stale/offline client sync late without clobbering more recent progress from
 * another device. ISO 8601 UTC timestamps compare correctly as plain strings.
 */
export async function setLastPosition(
  db: D1Database,
  userId: string,
  lessonId: string,
  updatedAtIso: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO academy_last_position (user_id, lesson_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         lesson_id = excluded.lesson_id,
         updated_at = excluded.updated_at
       WHERE excluded.updated_at >= academy_last_position.updated_at`
    )
    .bind(userId, lessonId, updatedAtIso)
    .run();
}

export async function getLastPosition(
  db: D1Database,
  userId: string
): Promise<LastPositionRow | null> {
  return db
    .prepare('SELECT lesson_id, updated_at FROM academy_last_position WHERE user_id = ?')
    .bind(userId)
    .first<LastPositionRow>();
}

// ---------------------------------------------------------------------------
// academy_exam_attempts
// ---------------------------------------------------------------------------

export async function insertExamAttempt(
  db: D1Database,
  row: {
    id: string;
    userId: string;
    score: number;
    passed: boolean;
    takenAt: string;
    questionIdsJson: string;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO academy_exam_attempts (id, user_id, score, passed, taken_at, question_ids_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(row.id, row.userId, row.score, row.passed ? 1 : 0, row.takenAt, row.questionIdsJson)
    .run();
}

export async function listExamAttempts(
  db: D1Database,
  userId: string
): Promise<ExamAttemptRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM academy_exam_attempts WHERE user_id = ? ORDER BY taken_at DESC')
    .bind(userId)
    .all<ExamAttemptRow>();
  return results;
}

export async function getExamAttemptById(
  db: D1Database,
  id: string
): Promise<ExamAttemptRow | null> {
  return db.prepare('SELECT * FROM academy_exam_attempts WHERE id = ?').bind(id).first<ExamAttemptRow>();
}

// ---------------------------------------------------------------------------
// academy_certificates
// ---------------------------------------------------------------------------

export async function insertCertificateIfAbsent(
  db: D1Database,
  row: {
    id: string;
    userId: string;
    attemptId: string;
    serial: string;
    holderName: string;
    score: number;
    jwt: string;
    isBest: boolean;
    issuedAt: string;
  }
): Promise<CertificateRow | null> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO academy_certificates
         (id, user_id, attempt_id, serial, holder_name, score, jwt, is_best, issued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.userId,
      row.attemptId,
      row.serial,
      row.holderName,
      row.score,
      row.jwt,
      row.isBest ? 1 : 0,
      row.issuedAt
    )
    .run();

  // Race-safe re-read keyed on the UNIQUE(attempt_id) index: whichever row actually
  // landed for this attempt wins, whether that was this call or a concurrent retry
  // of the same issue request (idempotency).
  return db
    .prepare('SELECT * FROM academy_certificates WHERE attempt_id = ?')
    .bind(row.attemptId)
    .first<CertificateRow>();
}

export async function markOthersNotBest(
  db: D1Database,
  userId: string,
  exceptId: string
): Promise<void> {
  await db
    .prepare('UPDATE academy_certificates SET is_best = 0 WHERE user_id = ? AND id != ?')
    .bind(userId, exceptId)
    .run();
}

export async function listCertificates(
  db: D1Database,
  userId: string
): Promise<CertificateRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM academy_certificates WHERE user_id = ? ORDER BY issued_at DESC')
    .bind(userId)
    .all<CertificateRow>();
  return results;
}

/** Public lookup path by design — no user_id filter. Used by the verify-by-serial route. */
export async function getCertificateBySerial(
  db: D1Database,
  serial: string
): Promise<CertificateRow | null> {
  return db
    .prepare('SELECT * FROM academy_certificates WHERE serial = ?')
    .bind(serial)
    .first<CertificateRow>();
}

// ---------------------------------------------------------------------------
// users (Lab-owned, read-only)
// ---------------------------------------------------------------------------

export async function getUserById(db: D1Database, userId: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<UserRow>();
}

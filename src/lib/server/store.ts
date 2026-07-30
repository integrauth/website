// Typed D1 accessors for THIS repo's own Academy tables: profiles,
// academy_lesson_progress, academy_quiz_progress, academy_last_position,
// academy_exam_attempts, academy_certificates, academy_progress_epoch. Every query
// is parameterized — never string-interpolate SQL here.
//
// This module does NOT touch the Lab-owned `users` table at all. It used to, to
// read an email for a certificate JWT claim; that claim was dropped (certs.ts
// explains why), and with it the last reason for this repo to read another repo's
// user records. The one Lab-owned table this repo still reads is `users`, joined in
// session.ts to check account status — NOT `sessions`, which nothing here touches
// any more (this repo has its own `website_sessions`). That join names its columns
// explicitly for the same reason.
//
// Row-count safety: the two list queries below (`listExamAttempts`,
// `listCertificates`) are bounded by explicit LIMITs — see MAX_* constants. Both
// feed JSON responses, and an unbounded SELECT would be an unbounded response body.
// The progress tables are bounded differently, at the route layer, by total-row
// ceilings — see `countLessonProgress` for why that is the only bound available.

export interface ProfileRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  name_locked_at: string | null;
  created_at: string;
  updated_at: string;
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
// The epoch guard on merge writes
// ---------------------------------------------------------------------------

/**
 * SQL fragment that makes a merge write conditional on the caller still being on the server's
 * CURRENT reset epoch, evaluated inside the same statement as the write.
 *
 * The route layer already checks the epoch before it writes, and that check is not sufficient: it
 * is a read, then several awaited D1 round trips, then a write. A `POST /progress/reset` from the
 * learner's other device can land in that gap — deleting the rows and bumping the epoch — after
 * which the first request's union writes arrive and resurrect progress under the NEW epoch. Nothing
 * downstream can ever correct that, because every future sync now agrees with the server's epoch:
 * the reset is permanently, silently partial.
 *
 * Re-checking in the statement closes it without a transaction (D1 has no interactive ones) and
 * without a migration. A row missing from academy_progress_epoch means "never reset", i.e. epoch 0,
 * which is why COALESCE is needed rather than a plain join.
 */
const EPOCH_STILL_CURRENT = `(SELECT COALESCE((SELECT epoch FROM academy_progress_epoch WHERE user_id = ?), 0)) = ?`;

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
  nowIso: string,
  expectedEpoch: number
): Promise<void> {
  if (lessonIds.length === 0) return;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO academy_lesson_progress (user_id, lesson_id, read_at)
     SELECT ?, ?, ? WHERE ${EPOCH_STILL_CURRENT}`
  );
  await db.batch(
    lessonIds.map((lessonId) => stmt.bind(userId, lessonId, nowIso, userId, expectedEpoch))
  );
}

/**
 * How many read marks this learner already has stored.
 *
 * Exists purely so the sync route can refuse to grow this table without bound. The curriculum is
 * 133 lessons and the server deliberately holds no copy of it (see `deleteLessonProgress`), so ids
 * arriving from a client cannot be validated against a canonical list — which means an
 * authenticated caller could otherwise loop `POST /progress/sync` with 500 junk ids a time and
 * write rows forever into a D1 instance this repo shares with, but does not own (wrangler.toml).
 * A single exact COUNT is cheap and is the only bound available without duplicating the curriculum.
 */
export async function countLessonProgress(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM academy_lesson_progress WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Same bound as `countLessonProgress`, for the per-track quiz masks. */
export async function countQuizProgress(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM academy_quiz_progress WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listLessonProgress(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT lesson_id FROM academy_lesson_progress WHERE user_id = ?')
    .bind(userId)
    .all<{ lesson_id: string }>();
  return results.map((r) => r.lesson_id);
}

/**
 * Deletes read marks — all of them, or just the named lessons.
 *
 * This is the one operation the union-shaped sync protocol has no way to express, which is why it
 * needs its own route and the epoch machinery below. See `bumpProgressEpoch`.
 *
 * `lessonIds` is supplied by the CLIENT for a track-scoped reset, and that is not laziness: the
 * curriculum (which lesson belongs to which track) lives entirely in academy.html's DOM and
 * functions.js, and the server has never had a copy of it. Deleting by an explicit, validated,
 * length-capped id list keeps the server from having to duplicate a 133-lesson mapping it would
 * then have to keep in sync with the front end forever. The blast radius is bounded by the fact
 * that every id is scoped to `user_id` — a caller can only ever delete their own rows.
 */
export async function deleteLessonProgress(
  db: D1Database,
  userId: string,
  lessonIds?: string[]
): Promise<number> {
  if (lessonIds === undefined) {
    const result = await db
      .prepare('DELETE FROM academy_lesson_progress WHERE user_id = ?')
      .bind(userId)
      .run();
    return result.meta?.changes ?? 0;
  }
  if (lessonIds.length === 0) return 0;
  const stmt = db.prepare(
    'DELETE FROM academy_lesson_progress WHERE user_id = ? AND lesson_id = ?'
  );
  const results = await db.batch(lessonIds.map((lessonId) => stmt.bind(userId, lessonId)));
  return results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
}

// ---------------------------------------------------------------------------
// academy_quiz_progress
// ---------------------------------------------------------------------------

/**
 * Bitwise-ORs incoming revealed-question masks into whatever is already stored for
 * each track, so two devices that each revealed different quiz questions offline
 * both end up reflected once synced (a reveal is one-way — never un-reveal a
 * question a device already knows was revealed elsewhere).
 *
 * Takes the whole set of tracks at once and sends them as ONE `db.batch()`, the
 * same way unionLessonProgress does. The route layer previously looped and
 * awaited one statement per track, which cost up to MAX_TRACK_IDS (50) serial
 * round-trips to D1 on a single sync — with identical semantics, since each
 * upsert is independent and the OR is commutative.
 */
export async function unionQuizMasks(
  db: D1Database,
  userId: string,
  entries: Array<[trackId: string, mask: number]>,
  nowIso: string,
  expectedEpoch: number
): Promise<void> {
  if (entries.length === 0) return;
  // The WHERE clause is doing double duty: it is the epoch guard, AND it is what lets SQLite parse
  // an upsert attached to an INSERT..SELECT at all (without a WHERE the ON CONFLICT is ambiguous).
  const stmt = db.prepare(
    `INSERT INTO academy_quiz_progress (user_id, track_id, revealed_mask, updated_at)
     SELECT ?, ?, ?, ? WHERE ${EPOCH_STILL_CURRENT}
     ON CONFLICT(user_id, track_id) DO UPDATE SET
       revealed_mask = revealed_mask | excluded.revealed_mask,
       updated_at = excluded.updated_at`
  );
  await db.batch(
    entries.map(([trackId, mask]) => stmt.bind(userId, trackId, mask, nowIso, userId, expectedEpoch))
  );
}

export async function listQuizProgress(
  db: D1Database,
  userId: string
): Promise<Record<string, number>> {
  const { results } = await db
    .prepare('SELECT track_id, revealed_mask FROM academy_quiz_progress WHERE user_id = ?')
    .bind(userId)
    .all<{ track_id: string; revealed_mask: number }>();
  // Null-prototype, because track ids are caller-chosen strings the server cannot validate against
  // a curriculum it does not hold: on a plain object a stored key of `__proto__` would hit the
  // Object.prototype accessor and silently vanish from every response (write-only row). No
  // pollution was possible either way — the values are validated integers — but the row should at
  // least round-trip.
  const out: Record<string, number> = Object.create(null);
  for (const row of results) out[row.track_id] = row.revealed_mask;
  return out;
}

/** Deletes revealed-question masks — all of them, or just one track's. */
export async function deleteQuizProgress(
  db: D1Database,
  userId: string,
  trackIds?: string[]
): Promise<number> {
  if (trackIds === undefined) {
    const result = await db
      .prepare('DELETE FROM academy_quiz_progress WHERE user_id = ?')
      .bind(userId)
      .run();
    return result.meta?.changes ?? 0;
  }
  if (trackIds.length === 0) return 0;
  const stmt = db.prepare('DELETE FROM academy_quiz_progress WHERE user_id = ? AND track_id = ?');
  const results = await db.batch(trackIds.map((trackId) => stmt.bind(userId, trackId)));
  return results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
}

// ---------------------------------------------------------------------------
// academy_progress_epoch — the reset channel for a union-merge protocol
// ---------------------------------------------------------------------------

/**
 * Reads a learner's current reset epoch. Absent row ⇒ 0 (never reset).
 *
 * WHY AN EPOCH AT ALL. Progress sync merges by union — read lessons are set membership, quiz
 * reveals are OR-ed masks — which is what makes it safe for a device that has been offline to
 * reconnect without deleting anything another device has since done. The cost of that choice is
 * that a union has no way to express a DELETION, and "Reset this track" / "Reset all progress" are
 * exactly deletions. Before the epoch, those buttons undid themselves: local marks were cleared,
 * the debounced sync fired, and the server unioned every id the client had just deleted straight
 * back in. Deleting server-side alone is still not enough — any OTHER device holding the old
 * progress re-unions its stale copy on its next sync, so the reset silently un-happens later on a
 * different machine.
 *
 * The epoch fixes that without changing the merge: each device remembers the epoch it last saw and
 * presents it on sync. A device whose epoch is behind the server's is holding pre-reset state, so
 * its payload is ignored and it is handed canonical truth plus the new epoch instead.
 */
export async function getProgressEpoch(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare('SELECT epoch FROM academy_progress_epoch WHERE user_id = ?')
    .bind(userId)
    .first<{ epoch: number }>();
  return row?.epoch ?? 0;
}

/**
 * Increments the reset epoch and returns the new value.
 *
 * Incremented in SQL (`epoch = epoch + 1`) rather than read-then-write, so two resets racing from
 * two devices cannot both read 3 and both write 4 — each lands its own increment.
 */
export async function bumpProgressEpoch(db: D1Database, userId: string): Promise<number> {
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO academy_progress_epoch (user_id, epoch, reset_at)
       VALUES (?, 1, ?)
       ON CONFLICT(user_id) DO UPDATE SET epoch = epoch + 1, reset_at = excluded.reset_at`
    )
    .bind(userId, nowIso)
    .run();
  return getProgressEpoch(db, userId);
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
  updatedAtIso: string,
  expectedEpoch: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO academy_last_position (user_id, lesson_id, updated_at)
       SELECT ?, ?, ? WHERE ${EPOCH_STILL_CURRENT}
       ON CONFLICT(user_id) DO UPDATE SET
         lesson_id = excluded.lesson_id,
         updated_at = excluded.updated_at
       WHERE excluded.updated_at >= academy_last_position.updated_at`
    )
    .bind(userId, lessonId, updatedAtIso, userId, expectedEpoch)
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

/**
 * Clears the stored "where was I" marker.
 *
 * Part of a reset, and it needs its own call rather than riding on the lesson delete: last-position
 * is the one field the sync merges last-write-wins by timestamp rather than by union, so leaving
 * the row behind after a reset means the next sync happily restores the learner to the lesson they
 * just reset out of. That was a real symptom of the pre-epoch behaviour.
 */
export async function clearLastPosition(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM academy_last_position WHERE user_id = ?').bind(userId).run();
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

/**
 * Most recent exam attempts, newest first, hard-capped. A learner who has taken
 * more than MAX_EXAM_ATTEMPTS_RETURNED exams does not need the tail of that list
 * rendered in the UI, and the cap stops a pathological (or abusive) row count from
 * producing a multi-megabyte JSON response — each row carries a 50-element
 * question_ids_json blob, so the payload grows fast.
 */
export const MAX_EXAM_ATTEMPTS_RETURNED = 200;

export async function listExamAttempts(
  db: D1Database,
  userId: string
): Promise<ExamAttemptRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM academy_exam_attempts WHERE user_id = ? ORDER BY taken_at DESC LIMIT ?'
    )
    .bind(userId, MAX_EXAM_ATTEMPTS_RETURNED)
    .all<ExamAttemptRow>();
  return results;
}

export async function getExamAttemptById(
  db: D1Database,
  id: string
): Promise<ExamAttemptRow | null> {
  return db.prepare('SELECT * FROM academy_exam_attempts WHERE id = ?').bind(id).first<ExamAttemptRow>();
}

/**
 * Abuse backstop support: how many exam attempts this user has recorded since
 * `sinceIso`. `taken_at` is always an ISO-8601 UTC string from toISOString(), and
 * those compare correctly as plain strings, so a `>=` range scan is exact.
 */
export async function countExamAttemptsSince(
  db: D1Database,
  userId: string,
  sinceIso: string
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM academy_exam_attempts WHERE user_id = ? AND taken_at >= ?')
    .bind(userId, sinceIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
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
  return getCertificateByAttemptId(db, row.attemptId);
}

/**
 * Looks up the certificate already minted for an exam attempt, if any. Keyed on the
 * UNIQUE(attempt_id) index, which is what makes certificate issuance idempotent:
 * the route layer calls this FIRST so a repeat "issue" for an attempt that already
 * has a certificate returns the stored row without re-signing a JWT (an ES256
 * signature plus a key import is the most expensive thing that endpoint does, and
 * on the re-issue path it was pure waste — the freshly signed token was discarded).
 */
export async function getCertificateByAttemptId(
  db: D1Database,
  attemptId: string
): Promise<CertificateRow | null> {
  return db
    .prepare('SELECT * FROM academy_certificates WHERE attempt_id = ?')
    .bind(attemptId)
    .first<CertificateRow>();
}

/**
 * Recomputes `is_best` across ALL of a learner's certificates from the stored rows.
 *
 * This replaced a caller-decides `markOthersNotBest(userId, winnerId)` helper, which was wrong for
 * anything concurrent because it needed an opinion from the caller about which row won. Two
 * DIFFERENT attempts certified at the same moment each read the same
 * "current best" score before inserting, so each concluded it had won and demoted the other — and
 * the learner ended up with NO certificate flagged best and no badge in their history. Deciding the
 * winner from the table instead makes the operation idempotent and self-correcting: whichever
 * request runs it last leaves the same, correct answer.
 *
 * The winner is the highest score, ties broken by most recently issued and then by `id` so the
 * result is total and deterministic (D1/SQLite has no row ordering to fall back on). Two statements
 * rather than one so the "demote everything" step cannot leave a gap where two rows are both best.
 */
export async function recomputeBestCertificate(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db
      .prepare('UPDATE academy_certificates SET is_best = 0 WHERE user_id = ? AND is_best != 0')
      .bind(userId),
    db
      .prepare(
        `UPDATE academy_certificates SET is_best = 1
          WHERE id = (
            SELECT id FROM academy_certificates
             WHERE user_id = ?
             ORDER BY score DESC, issued_at DESC, id DESC
             LIMIT 1
          )`
      )
      .bind(userId),
  ]);
}

/**
 * The learner's certificates, newest first, hard-capped for the same reason as
 * listExamAttempts (each row carries a full JWT string).
 *
 * IMPORTANT: because this is now truncated, it must never be used to compute an
 * aggregate over ALL of a user's certificates — a max/count over a truncated list
 * is simply wrong. Use getBestCertificateScore() / countCertificatesSince() for
 * that; both aggregate in SQL over the complete set.
 */
export const MAX_CERTIFICATES_RETURNED = 100;

export async function listCertificates(
  db: D1Database,
  userId: string
): Promise<CertificateRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM academy_certificates WHERE user_id = ? ORDER BY issued_at DESC LIMIT ?'
    )
    .bind(userId, MAX_CERTIFICATES_RETURNED)
    .all<CertificateRow>();
  return results;
}

/**
 * Highest score across ALL of this user's certificates, or -1 if they have none.
 * Used to decide whether a newly issued certificate becomes the "best" one.
 * Aggregated in SQL rather than by reducing listCertificates(), both because it's
 * one bounded round-trip instead of hauling every JWT back, and because
 * listCertificates() is LIMIT-ed and so cannot answer this question correctly.
 */
export async function getBestCertificateScore(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare('SELECT MAX(score) AS best FROM academy_certificates WHERE user_id = ?')
    .bind(userId)
    .first<{ best: number | null }>();
  return row?.best ?? -1;
}

/** Abuse backstop support — see countExamAttemptsSince() for the timestamp-comparison note. */
export async function countCertificatesSince(
  db: D1Database,
  userId: string,
  sinceIso: string
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM academy_certificates WHERE user_id = ? AND issued_at >= ?')
    .bind(userId, sinceIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Public lookup path by design — no user_id filter. Used by the verify-by-serial
 * route. `serial` MUST already be canonicalised (see normalizeCertificateSerial in
 * certs.ts): serials are stored in exactly one canonical form, and this is an
 * exact-match query, so a differently-cased or differently-hyphenated string that
 * a human typed will not match unless it is normalised first.
 */
export async function getCertificateBySerial(
  db: D1Database,
  serial: string
): Promise<CertificateRow | null> {
  return db
    .prepare('SELECT * FROM academy_certificates WHERE serial = ?')
    .bind(serial)
    .first<CertificateRow>();
}

/**
 * The minimum interval between progress resets.
 *
 * WHY THIS EXISTS. api.ts's file header names this site's abuse defences as the CSRF guard plus
 * "per-user daily caps on the two endpoints that INSERT rows with no natural bound ... plus
 * total-row ceilings on the progress-sync tables". `POST /api/academy/progress/reset` was neither:
 * authenticated, uncapped, and every call performs an upsert plus up to three DELETEs against a D1
 * shared with the Lab. It grows no rows — one epoch row per learner, forever — which is exactly why
 * neither existing defence covered it, and it was the one hole in a stated defence (2026-08 audit,
 * finding R22-W-08). It costs an attacker one authenticated session.
 *
 * It is bounded by elapsed time rather than by a daily count because there is nothing per-reset to
 * count: `academy_progress_epoch` holds one row per learner with a monotonic counter and the time
 * of the latest reset, and a per-reset row would need a migration, which lives in the Lab's repo.
 *
 * WHAT THIS FILE IS PROTECTING. Both directions, and the first matters more. A throttle on a
 * destructive action a learner deliberately asked for is a UX hazard: too long and a learner
 * resetting two tracks in a row is told no. So the boundary conditions are pinned exactly, and the
 * "never reset before" and "unreadable timestamp" cases are pinned as ALLOWING the reset, because
 * failing closed there would refuse a first-ever reset on a bad row.
 *
 * Run with `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_PROGRESS_RESET_INTERVAL_MS,
  progressResetRetryAfterSeconds,
} from '../src/lib/server/store.ts';

const NOW = Date.parse('2026-08-15T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('a learner who has never reset is never throttled', () => {
  assert.equal(progressResetRetryAfterSeconds(null, NOW), null);
});

test('an unreadable reset_at allows the reset rather than blocking it', () => {
  // A value we cannot parse is not evidence that a reset just happened. Failing closed here would
  // mean one bad row permanently refuses that learner's resets.
  for (const bad of ['', '   ', 'not a date', 'yesterday']) {
    assert.equal(progressResetRetryAfterSeconds(bad, NOW), null, `should allow: ${JSON.stringify(bad)}`);
  }
});

test('a reset outside the interval is allowed', () => {
  assert.equal(progressResetRetryAfterSeconds(ago(MIN_PROGRESS_RESET_INTERVAL_MS), NOW), null);
  assert.equal(progressResetRetryAfterSeconds(ago(MIN_PROGRESS_RESET_INTERVAL_MS + 1), NOW), null);
  assert.equal(progressResetRetryAfterSeconds(ago(60 * 60 * 1000), NOW), null);
  assert.equal(progressResetRetryAfterSeconds(ago(365 * 24 * 60 * 60 * 1000), NOW), null);
});

test('a reset inside the interval is refused, with the seconds left', () => {
  // Exactly at the boundary minus a millisecond is still inside.
  assert.equal(progressResetRetryAfterSeconds(ago(MIN_PROGRESS_RESET_INTERVAL_MS - 1), NOW), 1);
  assert.equal(progressResetRetryAfterSeconds(ago(0), NOW), MIN_PROGRESS_RESET_INTERVAL_MS / 1000);
  assert.equal(progressResetRetryAfterSeconds(ago(4_000), NOW), 6);
  assert.equal(progressResetRetryAfterSeconds(ago(9_500), NOW), 1);
});

test('the wait never rounds down to zero, which would be an unsatisfiable Retry-After', () => {
  for (let elapsed = 0; elapsed < MIN_PROGRESS_RESET_INTERVAL_MS; elapsed += 137) {
    const seconds = progressResetRetryAfterSeconds(ago(elapsed), NOW);
    assert.ok(seconds !== null, `expected a refusal at ${elapsed}ms`);
    assert.ok(Number.isInteger(seconds) && seconds >= 1, `bad Retry-After ${seconds} at ${elapsed}ms`);
    assert.ok(seconds <= MIN_PROGRESS_RESET_INTERVAL_MS / 1000, `overlong wait ${seconds}s`);
  }
});

test('a future reset_at is treated as "just reset", not as a disabled throttle', () => {
  // A server clock step between the write and this read must not silently switch the limit off.
  const future = new Date(NOW + 5_000).toISOString();
  const seconds = progressResetRetryAfterSeconds(future, NOW);
  assert.ok(seconds !== null && seconds >= 1, 'a future timestamp must not allow an unbounded rate');
});

test('the interval stays short enough to be invisible to a real learner', () => {
  // Every reset in the product sits behind a confirm dialog, and two track resets in a row also
  // cost a return to the hub, a track card, a lesson and the button. This is a deliberate
  // upper bound on the constant: raising it past a few tens of seconds starts refusing people who
  // meant it, which is a worse failure than the write volume this bounds.
  assert.ok(
    MIN_PROGRESS_RESET_INTERVAL_MS > 0 && MIN_PROGRESS_RESET_INTERVAL_MS <= 30_000,
    `MIN_PROGRESS_RESET_INTERVAL_MS is ${MIN_PROGRESS_RESET_INTERVAL_MS}ms — see the comment in store.ts`
  );
});

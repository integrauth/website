// The claim that replaces a cron trigger (audit R22-W-02).
//
// Two properties are worth a test here, and they fail in opposite directions:
//
//   1. The claim must succeed AT MOST ONCE per window. If it succeeded every time, a table-wide
//      UPDATE would run on every request to the Worker — the failure is a cost blow-up, not a wrong
//      answer, so nothing else would ever report it.
//   2. The claim must succeed AT LEAST ONCE per window. If it never succeeded, the sweep would
//      silently never run, which is precisely the state audit R22-W-02 exists to end — and it looks
//      identical from outside to the fix working.
//
// Both are exercised against a fake D1 that implements the one statement the claim uses, with the
// same semantics SQLite gives it (`changes` is 1 for an insert or a real update, 0 when the
// ON CONFLICT guard rejects). A test against a mock that always returns 1 would pass while proving
// nothing, so the mock's guard is the part to read carefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimSweepWindow } from '../src/lib/server/store.ts';

/**
 * The narrowest fake that can still be wrong in the ways that matter: it stores one row per job and
 * applies the `window_start < ?2` guard exactly as the real statement does.
 */
function fakeDb() {
  const rows = new Map();
  let writes = 0;
  return {
    writes: () => writes,
    prepare(sql) {
      assert.match(sql, /INSERT INTO academy_sweep_claim/, 'claim must use the claim table');
      assert.match(sql, /ON CONFLICT\(job\) DO UPDATE/, 'claim must be a single upsert statement');
      assert.match(sql, /window_start < \?2/, 'the guard is what makes this a claim, not a counter');
      return {
        bind(job, windowStart) {
          return {
            async run() {
              writes++;
              const current = rows.get(job);
              if (current === undefined || current < windowStart) {
                rows.set(job, windowStart);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

test('the first caller in a window claims it and every later one does not', async () => {
  const db = fakeDb();
  assert.equal(await claimSweepWindow(db, 'exam_ip_scrub', 1000), true, 'first call must claim');
  for (let i = 0; i < 25; i++) {
    assert.equal(
      await claimSweepWindow(db, 'exam_ip_scrub', 1000),
      false,
      'a repeat call inside the same window must not claim — otherwise the sweep runs per request',
    );
  }
});

test('the next window claims again — the sweep must not stop after the first hour', async () => {
  const db = fakeDb();
  assert.equal(await claimSweepWindow(db, 'exam_ip_scrub', 1000), true);
  assert.equal(await claimSweepWindow(db, 'exam_ip_scrub', 4600), true, 'a new window must claim');
  assert.equal(await claimSweepWindow(db, 'exam_ip_scrub', 4600), false);
});

test('an older window never re-claims, so a clock skew backwards cannot re-run the sweep', async () => {
  const db = fakeDb();
  assert.equal(await claimSweepWindow(db, 'exam_ip_scrub', 4600), true);
  assert.equal(await claimSweepWindow(db, 'exam_ip_scrub', 1000), false);
});

test('jobs are independent — one job claiming must not starve another', async () => {
  const db = fakeDb();
  assert.equal(await claimSweepWindow(db, 'exam_ip_scrub', 1000), true);
  assert.equal(await claimSweepWindow(db, 'some_other_job', 1000), true);
});

test('concurrent callers in one window produce exactly one claim', async () => {
  const db = fakeDb();
  const results = await Promise.all(
    Array.from({ length: 32 }, () => claimSweepWindow(db, 'exam_ip_scrub', 1000)),
  );
  assert.equal(
    results.filter(Boolean).length,
    1,
    'exactly one of 32 concurrent callers may claim the window',
  );
});

// CONTROL: the guard above is only meaningful if this fake can actually report a second claim. A
// fake that returned 0 unconditionally would pass every test above while proving nothing.
test('CONTROL: the fake reports a claim when the guard genuinely passes', async () => {
  const db = fakeDb();
  const claims = [1000, 4600, 8200].map(() => null);
  let n = 0;
  for (const w of [1000, 4600, 8200]) claims[n++] = await claimSweepWindow(db, 'ctl', w);
  assert.deepEqual(claims, [true, true, true], 'three successive windows must all claim');
});

// ---------------------------------------------------------------------------
// The window arithmetic.
//
// Computed from a millisecond clock, stored as seconds, so a unit slip is both easy and silent: a
// window 1000x too large is claimed once and never again (the sweep stops forever, reverting to the
// broken state this fix exists to end), and one 1000x too small is claimed on nearly every request
// (a table-wide UPDATE per request). Neither shows up as a wrong answer anywhere.

import { sweepWindowStartSeconds, SWEEP_WINDOW_MS } from '../src/lib/server/sweep.ts';

test('the window is hour-aligned epoch SECONDS, not milliseconds', () => {
  assert.equal(
    sweepWindowStartSeconds(10 * 3600 * 1000 + 1234),
    36000,
    'ten hours after the epoch is second 36000, not millisecond 36000000',
  );
  assert.equal(sweepWindowStartSeconds(0), 0);
});

test('every instant inside one hour maps to the same window, and the next hour does not', () => {
  const h = 5 * SWEEP_WINDOW_MS;
  const w = sweepWindowStartSeconds(h);
  assert.equal(sweepWindowStartSeconds(h + 1), w);
  assert.equal(sweepWindowStartSeconds(h + SWEEP_WINDOW_MS - 1), w, 'last ms of the hour');
  assert.notEqual(sweepWindowStartSeconds(h + SWEEP_WINDOW_MS), w, 'first ms of the next hour');
});

test('consecutive windows differ by exactly one hour in seconds', () => {
  const a = sweepWindowStartSeconds(9 * SWEEP_WINDOW_MS);
  const b = sweepWindowStartSeconds(10 * SWEEP_WINDOW_MS);
  assert.equal(b - a, 3600, 'a one-hour step must be 3600 seconds — the unit check, stated directly');
});

test('the window advances monotonically across a real timestamp', () => {
  const now = Date.UTC(2026, 7, 16, 13, 45, 30);
  assert.equal(sweepWindowStartSeconds(now), Math.floor(Date.UTC(2026, 7, 16, 13, 0, 0) / 1000));
});

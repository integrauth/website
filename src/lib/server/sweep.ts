// Window arithmetic for the periodic sweep that stands in for a cron trigger (audit R22-W-02).
//
// Its own module, with NO imports, for one practical reason: `api.ts` uses extensionless internal
// imports and so cannot be loaded by `node --test`, which means anything defined there is testable
// only through a fake of the whole request path. The part most worth testing here is a pure function
// of the clock, so it lives where a test can call it directly.
//
// WHY A CLAIM WINDOW AT ALL. The Cloudflare account is at the Workers Free plan's limit of 5 cron
// triggers, account-wide, all five held by other products, so this Worker cannot have one (see
// `wrangler.toml`). Instead the first request inside each window claims it in D1 and runs the sweep
// in `waitUntil` — the same shape the sibling `integrauth/lab` repo uses in `maybeRunCleanup`, with
// the claim in the shared database because this Worker has no Durable Object.

/** How often the sweep may run. One hour: frequent enough to bound retention, rare enough to cost nothing. */
export const SWEEP_WINDOW_MS = 60 * 60 * 1000;

/** Claim key in `academy_sweep_claim`. One row per job, forever. */
export const SWEEP_JOB_EXAM_IP = 'exam_ip_scrub';

/**
 * The current claim window, as hour-aligned epoch **seconds**.
 *
 * The unit change is the whole reason this is a named function with a test rather than an expression
 * at the call site. The clock arrives in milliseconds and the column stores seconds, and both ways of
 * getting that wrong are silent:
 *
 *   - a window 1000x too large is claimed once and then never again, so the sweep stops forever and
 *     the retention promise quietly reverts to the broken state this fix exists to end;
 *   - a window 1000x too small is claimed on essentially every request, turning a table-wide UPDATE
 *     into per-request work.
 *
 * Neither produces a wrong answer anywhere a test or a user would look, which is exactly why it is
 * pinned here.
 */
export function sweepWindowStartSeconds(nowMs: number): number {
  const windowsSinceEpoch = Math.floor(nowMs / SWEEP_WINDOW_MS);
  return windowsSinceEpoch * (SWEEP_WINDOW_MS / 1000);
}

/**
 * The final exam's DRAW — the half of the sitting the server did not used to check at all.
 *
 * WHY THIS EXISTS. `POST /api/academy/exam/attempts` validated each submitted entry (a known
 * question id, a distinct one, an integer choice in 0..3, exactly 50 of them) and nothing about the
 * sitting as a whole. Meanwhile the exam panel promises the learner, in so many words, "50 questions
 * spanning The Absolute Basics through Identity Architecture — at least 4 from every track", and
 * that stratification was a client-side property only. `academy_exam_attempts.question_ids_json`
 * therefore recorded whatever the caller sent, so a stored attempt could be 50 questions drawn from
 * a handful of tracks, and anything ever computed over that column would be reading caller-supplied
 * data as if it measured a stratified sitting (2026-08 audit, finding R22-W-06).
 *
 * `isWellFormedDraw` closes that. It is emphatically NOT an anti-cheating measure — the question
 * text and the correct index ship in the public bundle, which `exam.ts`'s header states plainly, and
 * the server still does not ISSUE the draw. What it does is make a recorded attempt match the shape
 * the learner was told it would have.
 *
 * WHAT THIS FILE IS REALLY GUARDING, and why it reads the client bundle. A server-side rule about
 * the shape of a client-produced draw is a loaded gun pointed at every real learner: get it a
 * fraction stricter than what `pick()` in js/academy-labs.js actually produces and every genuine
 * exam submission starts failing with `invalid_answers`, at the one moment a learner has just spent
 * twenty minutes answering questions. So rather than restating the rule, this runs the REAL draw
 * algorithm over the REAL pool extracted from the shipped bundle, many times, and requires the
 * server to accept every single result.
 *
 * Run with `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  EXAM_ANSWER_KEY,
  EXAM_GUARANTEED_PER_TRACK,
  EXAM_QUESTION_COUNT,
  isWellFormedDraw,
  requiredQuestionsPerTrack,
  trackOfQuestion,
} from '../src/lib/server/exam.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const LABS_JS = resolve(HERE, '../js/academy-labs.js');

/**
 * The client's question pool and draw parameters, read out of the shipped bundle rather than
 * retyped — a retyped copy would keep agreeing with the server after the bundle changed, which is
 * the failure this file exists to prevent.
 */
function loadClientPool() {
  const src = readFileSync(LABS_JS, 'utf8');

  const start = src.indexOf('var ACAD_EXAM_POOL = [');
  assert.ok(start > 0, 'could not find ACAD_EXAM_POOL in js/academy-labs.js');
  const body = src.slice(start, src.indexOf('\n];', start));

  const ids = [...body.matchAll(/\{\s*id:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, 'extracted no questions from ACAD_EXAM_POOL');

  const params = /var PASS = ([0-9.]+), N = (\d+), GUAR = (\d+);/.exec(src);
  assert.ok(params, 'could not find the exam draw parameters (PASS/N/GUAR) in js/academy-labs.js');

  return { ids, N: Number(params[2]), GUAR: Number(params[3]) };
}

/** A faithful transcription of `pick()`'s selection logic in js/academy-labs.js, ids only. */
function clientDraw({ ids, N, GUAR }, random = Math.random) {
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const byTrack = new Map();
  for (const id of ids) {
    const t = trackOfQuestion(id);
    if (!byTrack.has(t)) byTrack.set(t, []);
    byTrack.get(t).push(id);
  }
  let guaranteed = [];
  let rest = [];
  for (const qs of byTrack.values()) {
    const shuffled = shuffle(qs);
    guaranteed = guaranteed.concat(shuffled.slice(0, GUAR));
    rest = rest.concat(shuffled.slice(GUAR));
  }
  const filled = shuffle(
    guaranteed.concat(shuffle(rest).slice(0, Math.max(0, N - guaranteed.length)))
  );
  return filled.slice(0, Math.min(N, filled.length));
}

test('the server and the shipped bundle agree on the pool, question for question', () => {
  const { ids } = loadClientPool();
  const keyIds = Object.keys(EXAM_ANSWER_KEY);
  assert.deepEqual(
    [...ids].sort(),
    [...keyIds].sort(),
    'EXAM_ANSWER_KEY and ACAD_EXAM_POOL name different questions — see exam.ts on keeping them in sync'
  );
  assert.equal(new Set(ids).size, ids.length, 'ACAD_EXAM_POOL contains a duplicate id');
});

test('the server mirrors the client draw parameters it claims to mirror', () => {
  const { N, GUAR } = loadClientPool();
  assert.equal(EXAM_QUESTION_COUNT, N, 'EXAM_QUESTION_COUNT has drifted from the bundle N');
  assert.equal(EXAM_GUARANTEED_PER_TRACK, GUAR, 'EXAM_GUARANTEED_PER_TRACK has drifted from GUAR');
});

test('every track in the pool carries its own guaranteed floor', () => {
  const { ids, GUAR } = loadClientPool();
  const sizes = new Map();
  for (const id of ids) {
    const t = trackOfQuestion(id);
    sizes.set(t, (sizes.get(t) ?? 0) + 1);
  }
  const required = requiredQuestionsPerTrack();
  assert.equal(required.size, sizes.size, 'the server sees a different set of tracks than the pool');
  for (const [track, size] of sizes) {
    assert.equal(required.get(track), Math.min(GUAR, size), `wrong floor for track ${track}`);
  }
});

test('the server accepts every draw the shipped client actually produces', () => {
  const pool = loadClientPool();
  // Enough repetitions that the random fill has visited plenty of shapes; the guaranteed portion is
  // deterministic in size, so this is really probing the fill and the final slice.
  for (let i = 0; i < 500; i++) {
    const draw = clientDraw(pool);
    assert.equal(draw.length, EXAM_QUESTION_COUNT, 'the client produced a wrong-length sitting');
    assert.equal(new Set(draw).size, draw.length, 'the client produced a duplicate question');
    assert.ok(isWellFormedDraw(draw), `the server rejected a real client draw: ${draw.join(',')}`);
  }
});

test('a draw that starves whole tracks is rejected', () => {
  const { ids } = loadClientPool();
  const byTrack = new Map();
  for (const id of ids) {
    const t = trackOfQuestion(id);
    if (!byTrack.has(t)) byTrack.set(t, []);
    byTrack.get(t).push(id);
  }
  // Fill 50 questions out of as few tracks as possible — the exact shape the old route stored
  // happily, and the one the panel's "at least 4 from every track" promised could not happen.
  const skewed = [];
  for (const qs of byTrack.values()) {
    for (const id of qs) {
      if (skewed.length < EXAM_QUESTION_COUNT) skewed.push(id);
    }
    if (skewed.length >= EXAM_QUESTION_COUNT) break;
  }
  assert.equal(skewed.length, EXAM_QUESTION_COUNT);
  assert.equal(isWellFormedDraw(skewed), false, 'a single-track-heavy sitting was accepted');

  // And one question short in exactly one track is still a rejection — the floor is a floor.
  const good = clientDraw(loadClientPool());
  const victim = trackOfQuestion(good[0]);
  const trimmed = good.filter((id) => trackOfQuestion(id) !== victim);
  const spare = ids.find((id) => trackOfQuestion(id) !== victim && !trimmed.includes(id));
  const oneShort = trimmed.concat(
    good.filter((id) => trackOfQuestion(id) === victim).slice(0, EXAM_GUARANTEED_PER_TRACK - 1),
    spare ? [spare] : []
  );
  assert.equal(isWellFormedDraw(oneShort), false, 'a track below its floor was accepted');
});

test('the track of a question is derived from its id, not a second mapping', () => {
  assert.equal(trackOfQuestion('basics-01'), 'basics');
  assert.equal(trackOfQuestion('foundations-08'), 'foundations');
  // Defensive: an id with no separator is its own track rather than an empty-string one, so a
  // malformed id can never silently join a real track's bucket.
  assert.equal(trackOfQuestion('weird'), 'weird');
  assert.equal(trackOfQuestion('-01'), '-01');
});

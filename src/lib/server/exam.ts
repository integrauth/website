// Server-side final-exam answer key and grader.
//
// WHY THIS EXISTS. The Academy exam was graded entirely in the browser, and `POST /exam/attempts`
// simply trusted the `score`/`passed` the client sent — so any signed-in learner could POST
// `{score:100,passed:true}` (or the old `legacy-local-pass` sentinel) and mint a real, publicly
// verifiable certificate without answering a single question. This module moves the GRADING that
// gates a certificate onto the server: the client submits which option it chose for each drawn
// question, and `gradeExam` recomputes the score against the key below. The client can no longer
// assert a score at all.
//
// SCOPE, stated honestly. The question TEXT and options are still rendered from the public bundle
// (js/academy-labs.js), and that bundle still carries each question's correct index for the local
// "Review answers" screen — an exam whose questions render in the browser inherently exposes its
// answers to a determined reader, and that was already true of the old client-only exam. What this
// closes is the specific defect that a passing SCORE could be fabricated with no exam at all: the
// number a third party reads off /verify is now one the server computed from submitted choices, not
// one the client claimed.
//
// KEEPING THIS KEY IN SYNC with the pool. The answers here are keyed by the SAME stable question id
// the client pool (ACAD_EXAM_POOL in js/academy-labs.js) uses — ids are never renumbered, so this map
// is position-independent. When a question is added, retired, or its correct option changes, update
// BOTH this map and the pool's `a` for that id. `assertAnswerKeyShape` (exercised by the test suite)
// checks the shape here; a genuine drift between the two files surfaces at grade time as an
// `unknown_question` rejection rather than a silently mis-scored attempt.

/** Number of questions in a real sitting — mirrors `N` in js/academy-labs.js's lab-exam draw. */
export const EXAM_QUESTION_COUNT = 50;

/** Pass mark, percent — mirrors `PASS` (0.8) in js/academy-labs.js. */
export const EXAM_PASS_PERCENT = 80;

/**
 * id -> the ORIGINAL (pre-shuffle) index of the correct option, for every question in the pool.
 * The client shuffles options for display but submits its choice as this original index, so the
 * comparison here is against the option the author marked correct, regardless of on-screen order.
 */
export const EXAM_ANSWER_KEY: Record<string, number> = {
  'basics-01': 1, 'basics-02': 2, 'basics-03': 3, 'basics-04': 0, 'foundations-01': 1, 'foundations-02': 2,
  'foundations-03': 1, 'foundations-04': 2, 'authn-01': 1, 'authn-02': 2, 'authn-03': 1, 'authn-04': 2,
  'tokens-01': 1, 'tokens-02': 1, 'tokens-03': 1, 'tokens-04': 1, 'ai-01': 1, 'ai-02': 1,
  'ai-03': 1, 'ai-04': 1, 'ops-01': 1, 'ops-02': 1, 'ops-03': 1, 'ops-04': 1,
  'authz-01': 1, 'authz-02': 1, 'authz-03': 1, 'authz-04': 1, 'proto-01': 1, 'proto-02': 1,
  'proto-03': 1, 'proto-04': 1, 'atk-01': 1, 'atk-02': 1, 'atk-03': 1, 'atk-04': 1,
  'atk-05': 1, 'atk-06': 1, 'ciam-01': 1, 'ciam-02': 1, 'ciam-03': 1, 'ciam-04': 1,
  'cloud-01': 1, 'cloud-02': 1, 'cloud-03': 1, 'cloud-04': 1, 'arch-01': 1, 'arch-02': 1,
  'arch-03': 1, 'arch-04': 1, 'basics-05': 2, 'basics-06': 0, 'basics-07': 3, 'basics-08': 1,
  'foundations-05': 2, 'foundations-06': 0, 'foundations-07': 3, 'foundations-08': 1, 'authn-05': 2, 'authn-06': 1,
  'authn-07': 3, 'authn-08': 0, 'tokens-05': 1, 'tokens-06': 2, 'tokens-07': 3, 'tokens-08': 0,
  'ai-05': 1, 'ai-06': 2, 'ai-07': 0, 'ai-08': 3, 'ops-05': 1, 'ops-06': 2,
  'ops-07': 0, 'ops-08': 3, 'authz-05': 1, 'authz-06': 2, 'authz-07': 0, 'authz-08': 3,
  'proto-05': 1, 'proto-06': 2, 'proto-07': 0, 'proto-08': 3, 'atk-07': 1, 'atk-08': 2,
  'ciam-05': 0, 'ciam-06': 1, 'ciam-07': 2, 'ciam-08': 3, 'cloud-05': 0, 'cloud-06': 1,
  'cloud-07': 2, 'cloud-08': 3, 'arch-05': 0, 'arch-06': 1, 'arch-07': 2, 'arch-08': 3,
};

export interface SubmittedAnswer {
  id: string;
  /** The ORIGINAL option index the learner chose (0-based), as defined in the pool. */
  choice: number;
}

export interface GradeResult {
  /** Number answered correctly. */
  correct: number;
  /** Denominator — the number of questions in the sitting. */
  total: number;
  /** Percent, rounded to a whole number, exactly as the client used to compute it. */
  score: number;
  passed: boolean;
  /** The question ids of this sitting, in submission order — stored on the attempt row. */
  questionIds: string[];
}

/** Every id the answer key knows — used by validation to reject a sitting naming an unknown question. */
export function isKnownQuestion(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXAM_ANSWER_KEY, id);
}

/**
 * Questions guaranteed per track by the client's stratified draw — `GUAR` in js/academy-labs.js's
 * `pick()`. Mirrored here for the same reason EXAM_QUESTION_COUNT and EXAM_PASS_PERCENT are.
 */
export const EXAM_GUARANTEED_PER_TRACK = 4;

/**
 * The track a question belongs to, derived from its id.
 *
 * Ids are `<track>-<NN>` (`basics-01`, `foundations-07`, …) and the pool's own `t:` display label
 * is 1:1 with that prefix across all 96 questions — measured, not assumed. Deriving the track here
 * rather than shipping a second mapping means this cannot drift from the key above: a question the
 * key knows always has a track, and a question it does not know is rejected before this is reached.
 */
export function trackOfQuestion(id: string): string {
  const cut = id.lastIndexOf('-');
  return cut > 0 ? id.slice(0, cut) : id;
}

/**
 * How many questions from each track a well-formed sitting must contain, derived from the key.
 *
 * This mirrors `pick()` in js/academy-labs.js exactly, including its edge case. `pick()` takes
 * `min(GUAR, |track|)` from every track, concatenates them, fills to N from what is left, shuffles
 * and then `slice(0, N)`. That final slice is the catch: while the guaranteed set is no larger than
 * N it survives intact and the per-track floor holds, but if tracks ever multiply to the point that
 * `sum(min(GUAR, |track|)) > N`, the slice starts discarding guaranteed questions at random and the
 * client itself stops honouring the floor. Today that sum is 12 x 4 = 48 against N = 50, so the
 * floor holds; a 13th track would make it 52 and this returns an empty map, standing the per-track
 * rule down rather than rejecting every real learner's exam. That is the whole reason this is
 * computed rather than written down as "at least 4 of each".
 */
export function requiredQuestionsPerTrack(): Map<string, number> {
  const poolByTrack = new Map<string, number>();
  for (const id of Object.keys(EXAM_ANSWER_KEY)) {
    const track = trackOfQuestion(id);
    poolByTrack.set(track, (poolByTrack.get(track) ?? 0) + 1);
  }
  const required = new Map<string, number>();
  let guaranteed = 0;
  for (const [track, size] of poolByTrack) {
    const floor = Math.min(EXAM_GUARANTEED_PER_TRACK, size);
    required.set(track, floor);
    guaranteed += floor;
  }
  return guaranteed > EXAM_QUESTION_COUNT ? new Map() : required;
}

/**
 * True when `ids` is shaped like a draw the Academy's own exam panel would have produced.
 *
 * WHY THE SERVER CHECKS THE DRAW AT ALL, given that the answers are public anyway. It is not an
 * anti-cheating measure and cannot be one — this file's header is straight about the fact that a
 * determined reader can look the answers up in the public bundle, and refusing a malformed draw
 * does nothing about that. What it fixes is a different, quieter problem: the exam panel promises
 * the learner "50 questions ... at least 4 from every track", and until this existed that promise
 * was a client-side property only. `academy_exam_attempts.question_ids_json` stored whatever the
 * caller sent, so a recorded attempt could legitimately be 50 questions from one track, and
 * anything ever computed over that column would be reading caller-controlled data presented as a
 * measurement of a stratified sitting. Now a stored attempt matches the advertised shape.
 *
 * The caller must have already checked length, distinctness and that every id is known — this only
 * adds the stratification, and assumes those.
 *
 * RESIDUAL, stated so nobody mistakes this for more than it is: the server still does not ISSUE the
 * draw. It cannot tell a genuine sitting from a synthesised one that happens to be well-formed, and
 * a scripted 100% pass remains one request away, bounded only by the 3-per-account-and-network
 * daily limit. Closing that needs a server-issued, server-bound draw (a stored or signed draw id
 * the submission must reference), which is a real design change to both halves of the exam.
 */
export function isWellFormedDraw(ids: string[]): boolean {
  const required = requiredQuestionsPerTrack();
  if (required.size === 0) return true; // floor cannot be asserted — see requiredQuestionsPerTrack
  const seen = new Map<string, number>();
  for (const id of ids) {
    const track = trackOfQuestion(id);
    seen.set(track, (seen.get(track) ?? 0) + 1);
  }
  for (const [track, floor] of required) {
    if ((seen.get(track) ?? 0) < floor) return false;
  }
  return true;
}

/**
 * Grades a sitting. Throws `Error('unknown_question')` if any id is not in the key (a pool/key
 * drift, or a fabricated id) so the route can answer 400 rather than score against a partial key.
 * The caller is responsible for having already validated array length, distinctness and the shape
 * of each entry.
 */
export function gradeExam(answers: SubmittedAnswer[]): GradeResult {
  let correct = 0;
  const questionIds: string[] = [];
  for (const a of answers) {
    if (!isKnownQuestion(a.id)) {
      throw new Error('unknown_question');
    }
    questionIds.push(a.id);
    if (EXAM_ANSWER_KEY[a.id] === a.choice) correct++;
  }
  const total = answers.length;
  // Same rounding the browser used, so a borderline score reads identically to what the learner saw.
  const score = Math.round((correct / total) * 100);
  return { correct, total, score, passed: score >= EXAM_PASS_PERCENT, questionIds };
}

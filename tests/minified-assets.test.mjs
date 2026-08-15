/**
 * The shipped `js/*.min.js` files must be what the toolchain produces from their sources.
 *
 * WHY THIS EXISTS. Every one of the 11 HTML pages loads `js/academy-auth.min.js`, `js/functions.min.js`
 * and (on academy.html) `js/academy-labs.min.js`. None of them loads a `.js` source. So the file
 * everyone reviews and the file everyone runs are two different files, and until this test there was
 * nothing anywhere that checked they agreed: `package.json`'s `build:js` minified `functions.js`
 * ONLY, and no script produced the other two at all — they were kept in step by hand.
 *
 * They drifted, exactly as that arrangement predicts. An audit of this repo (2026-08,
 * `integrauth/lab` `docs/audit/gauntlet/R22-website-rp.md`, finding R22-W-04) found the shipped
 * `academy-auth.min.js` stale against its source by one string: the account panel's own description
 * of what deleting your account destroys. The source said the deletion also removes synced
 * sunnahfast tracker data — which `erasure.ts` confirms it does — and the file learners actually ran
 * did not. A signed-in learner was reading an understatement of an irreversible operation.
 *
 * The instance was one sentence. The class is that a generated file was not generated, and a text
 * diff of two minified blobs is not something a reviewer can be expected to do by eye. This test
 * does it by machine, on every push, before deploy.
 *
 * WHY BYTE EQUALITY, and what a failure means. Terser is pinned to an exact version in package.json
 * (not `^`) precisely so this comparison is reproducible; `npm ci` in CI installs that version. A
 * red result here NEVER means "the test is wrong" — it means the shipped artifact is not the
 * artifact the source implies, and the fix is always the same: run the matching `npm run
 * build:js:*` and commit the result. That is true whether the cause was an edited source nobody
 * re-minified, a hand-edited minified file, or a deliberate terser upgrade.
 *
 * Measured before this test was written: with terser 5.44.1 and `--compress --mangle`, the rebuild
 * of `functions.js` and `academy-labs.js` reproduced their shipped copies byte for byte, and
 * `academy-auth.js` reproduced its shipped copy byte for byte apart from that one sentence. So the
 * pinned toolchain is genuinely the one the committed artifacts came from.
 *
 * Run with `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { minify } = require('terser');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** Must match the `build:js:*` scripts in package.json, which are the only way these are produced. */
const TERSER_OPTIONS = { compress: true, mangle: true };

/** source -> shipped artifact, and the npm script that regenerates it. */
const BUNDLES = [
  ['js/functions.js', 'js/functions.min.js', 'npm run build:js:functions'],
  ['js/academy-auth.js', 'js/academy-auth.min.js', 'npm run build:js:auth'],
  ['js/academy-labs.js', 'js/academy-labs.min.js', 'npm run build:js:labs'],
];

/**
 * Reports a mismatch as the divergent REGION rather than as two 20-400 KB blobs, which is the
 * difference between a usable failure and an unreadable one. Minified files are a single line, so
 * a line-oriented diff would print the whole file as one changed line.
 */
function describeDivergence(shipped, rebuilt) {
  let prefix = 0;
  while (prefix < shipped.length && prefix < rebuilt.length && shipped[prefix] === rebuilt[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < shipped.length - prefix &&
    suffix < rebuilt.length - prefix &&
    shipped[shipped.length - 1 - suffix] === rebuilt[rebuilt.length - 1 - suffix]
  ) {
    suffix++;
  }
  const clip = (s) => (s.length > 400 ? `${s.slice(0, 400)}… (${s.length} chars)` : s);
  return [
    `shipped and rebuilt agree on the first ${prefix} and last ${suffix} characters.`,
    `  shipped : ${JSON.stringify(clip(shipped.slice(prefix, shipped.length - suffix)))}`,
    `  rebuilt : ${JSON.stringify(clip(rebuilt.slice(prefix, rebuilt.length - suffix)))}`,
  ].join('\n');
}

for (const [source, artifact, rebuildCmd] of BUNDLES) {
  test(`${artifact} is exactly what terser produces from ${source}`, async () => {
    const src = readFileSync(resolve(ROOT, source), 'utf8');
    const shipped = readFileSync(resolve(ROOT, artifact), 'utf8');

    const result = await minify(src, TERSER_OPTIONS);
    assert.ok(typeof result.code === 'string', `terser produced no output for ${source}`);

    assert.equal(
      result.code,
      shipped,
      `${artifact} is stale against ${source}.\n` +
        `Regenerate it with \`${rebuildCmd}\` and commit the result.\n` +
        describeDivergence(shipped, result.code)
    );
  });
}

/**
 * The specific sentence R22-W-04 was about, pinned by content rather than only by the byte-equality
 * check above. Byte equality would go green again if someone deleted the clause from BOTH files, so
 * this asserts the claim itself survives: the account panel must keep telling a signed-in learner
 * that deleting the shared account also destroys their synced sunnahfast data. That cascade is real
 * (`erasure.ts`'s `deleteSunnahfastTrackerDaysByUser`), and understating an irreversible deletion in
 * the UI that offers it is the actual harm.
 */
test('the account panel still discloses the full deletion cascade, in both files', () => {
  const src = readFileSync(resolve(ROOT, 'js/academy-auth.js'), 'utf8');
  const min = readFileSync(resolve(ROOT, 'js/academy-auth.min.js'), 'utf8');

  // The source writes this as a multi-line concatenation, so it is matched in fragments there and
  // as one folded literal in the minified copy.
  const fragments = [
    'sunnahfast.integrauth.com',
    'and any synced sunnahfast trackers',
  ];
  for (const fragment of fragments) {
    assert.ok(src.includes(fragment), `js/academy-auth.js no longer mentions "${fragment}"`);
    assert.ok(min.includes(fragment), `js/academy-auth.min.js no longer mentions "${fragment}"`);
  }
});

/**
 * Every page must load the artifact, not the source — and all of them must load the SAME query
 * string, or a stale cached copy survives on whichever pages were missed. This is what makes the
 * byte-equality tests above matter: they guard the file the site actually serves.
 */
test('every HTML page loads the minified auth bundle at one agreed version', () => {
  const pages = [
    '404.html',
    'academy.html',
    'ai-agent-security.html',
    'api-security.html',
    'cancellation.html',
    'index.html',
    'mcp-security.html',
    'privacy.html',
    'support.html',
    'terms.html',
    'verify.html',
  ];
  const versions = new Set();
  for (const page of pages) {
    const html = readFileSync(resolve(ROOT, page), 'utf8');
    const refs = [...html.matchAll(/js\/academy-auth(\.min)?\.js(\?v=([0-9.]+))?/g)];
    assert.equal(refs.length, 1, `${page} should reference the auth bundle exactly once`);
    assert.equal(refs[0][1], '.min', `${page} loads the unminified auth source`);
    assert.ok(refs[0][3], `${page} loads the auth bundle with no ?v= cache-buster`);
    versions.add(refs[0][3]);
  }
  assert.equal(
    versions.size,
    1,
    `pages disagree about the auth bundle version: ${[...versions].join(', ')}`
  );
});

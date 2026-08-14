/**
 * Certificate-serial lookup — the server arm and the client box that feeds it.
 *
 * WHY THIS IS THE REPO'S FIRST TEST. `/verify` is the one page here whose failure mode is
 * invisible to us: it renders a verdict to a third party — an employer checking a credential —
 * who never tells us it was wrong. An audit of this repo (2026-08, `integrauth/lab`
 * `docs/audit/gauntlet/R22-website-rp.md`, finding R22-W-03) found that a certificate minted
 * before the `IA-XXXX-XXXX-XXXX` format could not be verified by ANY code path:
 *
 *   - the server reached `getCertificateBySerial` only through `normalizeCertificateSerial`,
 *     which returns null for anything that is not `IA` + 12 Crockford characters, and that null
 *     was answered as an authoritative `{valid:false}`;
 *   - and the input box on `verify.html` had already destroyed such a serial before submit —
 *     it uppercased and re-cut everything into groups of four, so a case-sensitive nanoid and a
 *     36-character randomUUID both left the box mangled and were then rejected locally, without
 *     a request ever being sent.
 *
 * Legacy serials cannot be migrated away: the serial is the `jti` inside an already-signed JWT,
 * so rewriting it would invalidate the signature. Both halves are therefore permanent
 * requirements, and this file pins both.
 *
 * No test framework and no new dependency: `node --test` with type-stripping, so the server
 * function under test is imported from its real `.ts` source and the client functions are
 * extracted from the real `verify.html` rather than retyped here (a retyped copy would keep
 * passing after the page regressed, which is the failure this whole file exists to prevent).
 *
 * Run with `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { certificateSerialLookupCandidates } from '../src/lib/server/certs.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY_HTML = resolve(HERE, '../verify.html');

/** The documented predecessor format (see generateCertificateSerial's docstring). */
const UUID = '3f2a1b9c-4d5e-6f70-8192-a3b4c5d6e7f8';
/** `genId()` output, per the Lab's migration 0050_academy_certificates.sql. */
const NANOID = 'V1StGXR8_Z5jdHi6B-myT';
const MODERN = 'IA-4KD7-9QX2-M3F8';

test('server: a modern serial is looked up canonically, however it was typed', () => {
  assert.deepEqual(certificateSerialLookupCandidates(MODERN), [MODERN]);
  // Lowercased/mis-hyphenated off a screenshot: the raw attempt is harmless, the canonical
  // one is what finds the row.
  assert.deepEqual(certificateSerialLookupCandidates('ia-4kd7-9qx2-m3f8'), [
    'ia-4kd7-9qx2-m3f8',
    MODERN,
  ]);
  assert.deepEqual(certificateSerialLookupCandidates('IA4KD79QX2M3F8'), ['IA4KD79QX2M3F8', MODERN]);
  // Crockford leniency: a typed O is the digit 0, a typed I/L is the digit 1.
  assert.ok(certificateSerialLookupCandidates('IA-4KD7-9QX2-M3FO').includes('IA-4KD7-9QX2-M3F0'));
});

test('server: a LEGACY serial is looked up verbatim — the arm R22-W-03 was missing', () => {
  // Exactly one candidate each, and it must be byte-identical: legacy serials are
  // case-sensitive, so a canonicalising pass cannot be allowed anywhere near them.
  assert.deepEqual(certificateSerialLookupCandidates(NANOID), [NANOID]);
  assert.deepEqual(certificateSerialLookupCandidates(UUID), [UUID]);
  assert.deepEqual(certificateSerialLookupCandidates(`  ${NANOID}  `), [NANOID]);
});

test('server: junk yields no candidates, so D1 is never touched for it', () => {
  for (const junk of ['', '   ', 'short', 'hello world!!', "'; DROP TABLE", 'x'.repeat(200)]) {
    assert.deepEqual(certificateSerialLookupCandidates(junk), [], `expected no lookup for ${junk}`);
  }
  // Not a string at all (a router can hand us undefined).
  assert.deepEqual(certificateSerialLookupCandidates(undefined), []);
});

/**
 * The client half. `formatSerialInput` and `normalizeSerial` are extracted from the shipped
 * `verify.html` and executed, so this fails if the page's own copy regresses.
 */
function loadVerifyClient() {
  const html = readFileSync(VERIFY_HTML, 'utf8');
  const grab = (re, what) => {
    const m = re.exec(html);
    assert.ok(m, `could not extract ${what} from verify.html — the test cannot measure the page`);
    return m[0];
  };
  const consts = grab(/var SERIAL_ALPHABET=[^\n]*?;/, 'the serial constants');
  const normalize = grab(/function normalizeSerial\(input\)\{[\s\S]*?\n\}/, 'normalizeSerial');
  const format = grab(/function formatSerialInput\(raw\)\{[\s\S]*?\n\}/, 'formatSerialInput');
  const opaqueLine = grab(/if\(!serial&&\/\^[^\n]*?\)serial=typed;/, 'the legacy-opaque submit arm');
  const opaqueSrc = /\/(\^[^/]+)\/\.test/.exec(opaqueLine)[1];

  const scope = new Function(
    `${consts}\n${normalize}\n${format}\n` +
      `return {normalizeSerial, formatSerialInput, OPAQUE: new RegExp(${JSON.stringify(opaqueSrc)})};`,
  )();

  // Reproduces the submit handler's two lines, in order: canonicalise, else send verbatim.
  scope.submitted = (typed) => {
    const stripped = typed.replace(/\s+/g, '');
    const canonical = scope.normalizeSerial(stripped);
    if (canonical) return canonical;
    return scope.OPAQUE.test(stripped) ? stripped : null; // null = rejected without a request
  };
  return scope;
}

test('client: the input box leaves a legacy serial exactly as typed', () => {
  const { formatSerialInput } = loadVerifyClient();
  // The regression that made R22-W-03 unfixable from the server alone: these came back
  // uppercased and re-cut into groups of four.
  assert.equal(formatSerialInput(UUID), UUID);
  assert.equal(formatSerialInput(NANOID), NANOID);
  assert.equal(formatSerialInput('IA20260101953f2a1b9c'), 'IA20260101953f2a1b9c');
});

test('client: the box still auto-formats a modern serial as it is typed', () => {
  const { formatSerialInput } = loadVerifyClient();
  assert.equal(formatSerialInput('IA4KD79QX2M3F8'), MODERN);
  assert.equal(formatSerialInput('ia-4kd7-9qx2-m3f8'), MODERN);
  assert.equal(formatSerialInput('ia4kd'), 'IA-4KD');
  assert.equal(formatSerialInput(''), '');
});

test('client: a legacy serial is SENT, and only real junk is rejected locally', () => {
  const { submitted } = loadVerifyClient();
  assert.equal(submitted(UUID), UUID);
  assert.equal(submitted(NANOID), NANOID);
  assert.equal(submitted('ia-4kd7-9qx2-m3f8'), MODERN);
  // Still rejected without a network call — the one message on that page that asserts
  // something about the ID itself must stay reserved for input that can be no serial at all.
  assert.equal(submitted('hello world!!'), null);
  assert.equal(submitted('IA-4KD'), null);
});

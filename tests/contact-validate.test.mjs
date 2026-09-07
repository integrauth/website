/**
 * Contact form input validation (src/lib/server/contact-validate.ts).
 *
 * The values here end up in a Reply-To header and a Subject line, so the guards that matter are
 * the header-injection ones; the rest pins the honeypot and the size limits the page advertises.
 *
 * Run with `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContact } from '../src/lib/server/contact-validate.ts';

const good = { name: 'Maya', email: 'maya@example.com', company: 'Acme', message: 'We need help with OIDC.' };

test('accepts a normal message and trims fields', () => {
  const r = validateContact({ ...good, name: '  Maya  ' });
  assert.ok(r.ok);
  assert.equal(r.value.name, 'Maya');
});

test('rejects the honeypot, header injection, and bad sizes', () => {
  assert.equal(validateContact({ ...good, website: 'http://spam' }).ok, false);
  assert.equal(validateContact({ ...good, name: 'Maya\r\nBcc: x@y.z' }).ok, false);
  assert.equal(validateContact({ ...good, email: 'not an email' }).ok, false);
  assert.equal(validateContact({ ...good, message: 'short' }).ok, false);
  assert.equal(validateContact({ ...good, message: 'x'.repeat(4001) }).ok, false);
  assert.equal(validateContact(null).ok, false);
});

/**
 * Which hostnames may begin a login.
 *
 * WHY THIS EXISTS. `rpConfigFromEnv` derives this site's `redirect_uri` from the LIVE request
 * origin, so `/auth/start` will build an authorization URL for whatever host reached the Worker.
 * The Lab matches redirect URIs by exact string equality against a list committed in its own
 * wrangler.toml, and that list is exactly the two production origins. `workers_dev = true` was
 * re-enabled on 2026-08-01 so CI's health probes have a URL outside the zone's Bot Fight Mode, and
 * the helpers that once registered that origin at the Lab were deleted at the 2026-08 cutover and
 * stayed deleted — so the workers.dev host serves `/auth/*` and cannot complete a login (2026-08
 * audit, finding R22-W-05). `/auth/start` now refuses it locally instead of redirecting a visitor
 * into a rejection on a domain they did not choose to visit.
 *
 * WHAT THIS FILE IS ACTUALLY PROTECTING. Not the workers.dev host — nothing links there and nothing
 * is meant to sign in through it. It protects the two hostnames that MUST keep working. This is a
 * predicate that gates the entry point to sign-in for the whole site, so the interesting assertions
 * here are the negative ones: integrauth.com and www.integrauth.com must never match it, however the
 * hostname is cased or however a suffix check is later rewritten.
 *
 * Run with `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isLocalDevHost, isUnregisterableLoginHost } from '../src/lib/server/session.ts';

/** The two origins the Lab registers, and the only ones real visitors ever see. */
const PRODUCTION_ORIGINS = ['https://integrauth.com', 'https://www.integrauth.com'];

test('production origins can always begin a login', () => {
  for (const origin of PRODUCTION_ORIGINS) {
    for (const path of ['/auth/start', '/auth/start?mode=redirect&return=%2Facademy']) {
      const url = new URL(origin + path);
      assert.equal(
        isUnregisterableLoginHost(url),
        false,
        `${url.hostname} would be refused sign-in — this breaks the whole site`
      );
    }
  }
  // Case is not something a URL parser leaves for us to worry about, but the predicate lowercases
  // anyway; assert the result rather than the mechanism.
  assert.equal(isUnregisterableLoginHost(new URL('https://INTEGRAUTH.COM/auth/start')), false);
  assert.equal(isUnregisterableLoginHost(new URL('https://WWW.Integrauth.com/auth/start')), false);
});

test('the workers.dev host is refused', () => {
  const refused = [
    'https://integrauth-website.someaccount.workers.dev/auth/start',
    'https://anything.workers.dev/auth/start',
    'https://WEBSITE.WORKERS.DEV/auth/start',
    'https://workers.dev/auth/start',
  ];
  for (const href of refused) {
    assert.equal(isUnregisterableLoginHost(new URL(href)), true, `${href} should be refused`);
  }
});

test('the suffix check cannot be fooled by a lookalike hostname', () => {
  // A registrable domain merely CONTAINING or ENDING WITH the string is not the same as being a
  // subdomain of it. Both directions matter: the first would refuse sign-in on a real host, the
  // second would let a host we meant to refuse through.
  const notWorkersDev = [
    'https://notworkers.dev/auth/start',
    'https://myworkers.dev/auth/start',
    'https://workers.dev.example.com/auth/start',
    'https://integrauth.com.workers.dev.evil.example/auth/start',
  ];
  for (const href of notWorkersDev) {
    assert.equal(
      isUnregisterableLoginHost(new URL(href)),
      false,
      `${href} is not the Worker's workers.dev host`
    );
  }
});

test('localhost is deliberately still allowed to begin a login', () => {
  // Equally unregistered at the Lab, and deliberately NOT refused: bouncing to the Lab is the
  // documented local-dev behaviour and a developer reading a Lab error page is not a stranded
  // visitor. If this ever flips, it should be because someone decided to, not by accident.
  for (const href of ['http://localhost:8787/auth/start', 'http://127.0.0.1:8787/auth/start']) {
    const url = new URL(href);
    assert.equal(isLocalDevHost(url), true, `${href} should be recognised as local dev`);
    assert.equal(isUnregisterableLoginHost(url), false, `${href} should still reach the Lab`);
  }
});

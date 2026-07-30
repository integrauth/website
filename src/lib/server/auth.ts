// The /auth/* surface: this site's OIDC Relying Party endpoints and its own session lifecycle.
//
// Split from api.ts (which serves /api/academy/*) because the two have genuinely different
// contracts. These routes redirect browsers, render HTML, and accept one unauthenticated
// server-to-server POST; those serve JSON to a signed-in learner. Sharing api.ts's blanket CSRF
// middleware would have been actively wrong — see the back-channel logout route for why.
//
// ROUTE MAP
//   GET  /auth/start               begin login: mint PKCE + state + nonce, redirect to the Lab
//   GET  /auth/callback            finish login: exchange the code, mint our session
//   GET  /auth/session             who-am-I (replaces the old cross-origin call to the Lab)
//   POST /auth/logout              end this device's session
//   POST /auth/logout-all          end this account's sessions on every device
//   POST /auth/sessions/revoke     end one named session (the device list's per-row button)
//   POST /auth/backchannel-logout  the Lab telling us a user signed out (OIDC BCL 1.0)

import { Hono } from 'hono';
import type { Env } from './env';
import { isAllowedOrigin } from './api';
import {
  buildSessionCookie,
  clearSessionCookie,
  createSession,
  IDLE_MS,
  listSessions,
  parseSessionCookie,
  revokeSession,
  revokeSessionsBySid,
  revokeSessionsByUser,
  sessionBelongsToUser,
  summarizeUserAgent,
  validateSession,
} from './session';
import {
  buildAuthorizeUrl,
  buildTxCookie,
  clearTxCookie,
  exchangeCode,
  newTransaction,
  OidcError,
  readTxCookie,
  rpConfigFromEnv,
  s256,
  safeReturnPath,
  timingSafeEqual,
  verifyLogoutToken,
} from './oidc-rp';

/**
 * localStorage key the callback page writes to hand the result back to the tab that opened it.
 *
 * WHY localStorage AND NOT `postMessage`, which is the obvious answer: both apps send
 * `Cross-Origin-Opener-Policy: same-origin`. When a page with that header opens a popup that then
 * navigates to a *different* origin which also sends it, the browser moves the popup into a
 * separate browsing-context group and severs `window.opener` permanently. Returning to our own
 * origin later does not undo it — there is no opener left to rejoin. So the popup cannot
 * `postMessage` the opener, and the opener cannot even poll `popup.closed` (a severed handle
 * reports `closed === true` immediately). localStorage is per-origin and entirely independent of
 * browsing-context groups, and its `storage` event fires in every OTHER same-origin context, which
 * is exactly the delivery we need. MUST MATCH the constant in js/academy-auth.js.
 */
const AUTH_EVENT_KEY = 'acad_auth_event_v1';

/** Escapes text for safe interpolation into an HTML document. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The tiny page the popup lands on at the end of the flow: it announces the result to the opening
 * tab and closes itself.
 *
 * The inline script is allowed by a per-response nonce rather than `'unsafe-inline'`, so this page
 * grants no blanket inline-script permission it does not need. Everything is JSON-encoded into a
 * data attribute rather than interpolated into JS source, so no value from the query string is
 * ever parsed as code.
 */
function closingPage(params: {
  nonce: string;
  ok: boolean;
  error: string | null;
  ret: string;
  eventKey: string;
}): string {
  const payload = JSON.stringify({
    ok: params.ok,
    error: params.error,
    ret: params.ret,
    key: params.eventKey,
  });
  const heading = params.ok ? 'Signed in' : 'Sign-in failed';
  const detail = params.ok
    ? 'You can close this window.'
    : 'You can close this window and try again.';

  return `<!doctype html>
<html lang="en" data-boot-theme="cyber">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(heading)} — IntegrAuth</title>
<style nonce="${params.nonce}">
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0f172a; color: #e2e8f0;
    font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    text-align: center; padding: 2rem;
  }
  .box { max-width: 24rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: 0; color: #94a3b8; font-size: .9rem; }
</style>
</head>
<body>
<div class="box" id="ia-auth-result" data-payload="${escapeHtml(payload)}">
  <h1>${escapeHtml(heading)}</h1>
  <p>${escapeHtml(detail)}</p>
</div>
<script nonce="${params.nonce}">
(function () {
  var node = document.getElementById('ia-auth-result');
  var data = {};
  try { data = JSON.parse(node.getAttribute('data-payload')); } catch (e) { return; }

  // Primary channel: a localStorage write, which raises a 'storage' event in the opening tab.
  try {
    localStorage.setItem(data.key, JSON.stringify({
      t: Date.now(), ok: !!data.ok, error: data.error || null
    }));
  } catch (e) { /* private mode / storage disabled — the opener's poll fallback covers it */ }

  // Secondary, best-effort: works only if COOP ever stops severing the opener. Wrapped because
  // touching a severed window.opener can throw.
  try {
    if (window.opener) {
      window.opener.postMessage({ source: 'integrauth-auth', ok: !!data.ok, error: data.error || null }, window.location.origin);
    }
  } catch (e) { /* expected under COOP: same-origin */ }

  // A window the script did not open cannot close itself, so this silently no-ops when the user
  // got here by a full-page redirect (popup blocked). The timeout then takes them home.
  try { window.close(); } catch (e) { /* noop */ }
  setTimeout(function () {
    if (!window.closed) window.location.replace(data.ret || '/academy');
  }, 600);
})();
</script>
</body>
</html>`;
}

/** Wraps an HTML string in a Response carrying a CSP that permits only this page's own nonce. */
function htmlResponse(body: string, nonce: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'nonce-${nonce}'`,
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    },
  });
}

export function createAuthApp() {
  const app = new Hono<{ Bindings: Env }>().basePath('/auth');

  /**
   * CSRF guard for the browser-facing POSTs — the same Origin + JSON content-type pair api.ts
   * uses, and see that file for the full reasoning.
   *
   * `/auth/backchannel-logout` is deliberately NOT behind this, and that exemption is safe for a
   * specific reason rather than by convenience: it is a server-to-server call from the Lab's
   * Worker, so it has no `Origin` header to check and is form-encoded rather than JSON — it would
   * fail both checks. What authenticates it instead is strictly stronger than an Origin header: a
   * logout token signed by the provider's ES256 key, verified against its published JWKS, with
   * `aud` pinned to our client_id, `typ` pinned to `logout+jwt`, and a 5-minute age bound.
   * An attacker who could forge that would not need CSRF.
   */
  app.use('*', async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') {
      return next();
    }
    if (new URL(c.req.url).pathname === '/auth/backchannel-logout') {
      return next();
    }
    const origin = c.req.header('Origin');
    if (!origin || !isAllowedOrigin(origin, new URL(c.req.url))) {
      return c.json({ error: 'forbidden_origin' }, 403);
    }
    const mediaType = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return c.json({ error: 'unsupported_media_type' }, 415);
    }
    return next();
  });

  // -------------------------------------------------------------------------
  // login
  // -------------------------------------------------------------------------

  /**
   * Begins a login. Redirects the browser to the Lab's authorization endpoint and stashes the
   * matching PKCE verifier, `state` and `nonce` in a short-lived host-locked cookie.
   *
   * `?return=` is the same-origin path to land on afterwards; `?mode=redirect` marks a flow that
   * started as a full-page navigation (because the popup was blocked) so the callback navigates
   * instead of trying to close a window it did not open.
   */
  app.get('/start', async (c) => {
    const url = new URL(c.req.url);
    const config = rpConfigFromEnv(c.env, url);
    if (!config) {
      // Sign-in genuinely cannot work yet (no client secret provisioned). Say so plainly rather
      // than bouncing the user to a provider that will reject an unseeded client.
      return c.json({ error: 'sign_in_unavailable' }, 503);
    }

    const ret = safeReturnPath(url.searchParams.get('return'));
    const mode = url.searchParams.get('mode') === 'redirect' ? 'redirect' : 'popup';
    const tx = newTransaction(ret, mode);
    const challenge = await s256(tx.verifier);

    const headers = new Headers({
      Location: buildAuthorizeUrl(config, tx, challenge),
      'Cache-Control': 'no-store',
    });
    headers.append('Set-Cookie', buildTxCookie(url, tx));
    return new Response(null, { status: 302, headers });
  });

  /**
   * Finishes a login: validates `state`, exchanges the code, verifies the ID token, and mints this
   * site's own session.
   *
   * Every failure path renders the SAME closing page with `ok:false` rather than an error page,
   * because in popup mode there is no user looking at this document — the tab that started the
   * flow is. A bare 400 here would leave that tab waiting forever with no idea anything went
   * wrong.
   */
  app.get('/callback', async (c) => {
    const url = new URL(c.req.url);
    const nonce = crypto.randomUUID();
    const tx = readTxCookie(c.req.header('Cookie') ?? null, url);

    const fail = (error: string, status = 400) => {
      const response = htmlResponse(
        closingPage({
          nonce,
          ok: false,
          error,
          ret: tx?.ret ?? '/academy',
          eventKey: AUTH_EVENT_KEY,
        }),
        nonce,
        status
      );
      response.headers.append('Set-Cookie', clearTxCookie(url));
      return response;
    };

    const config = rpConfigFromEnv(c.env, url);
    if (!config) return fail('sign_in_unavailable', 503);
    if (!tx) return fail('no_transaction');

    // The provider reports user-visible refusals (a denied consent screen, an invalid request) as
    // redirect parameters, not as a failed exchange. Surface its code rather than a generic one.
    const providerError = url.searchParams.get('error');
    if (providerError) return fail(providerError);

    const state = url.searchParams.get('state') ?? '';
    if (!state || !timingSafeEqual(state, tx.state)) return fail('state_mismatch');

    // Mix-up defence. Only checked when present: the provider does not currently return `iss` on
    // the authorization response, and rejecting its absence would break every login. With a single
    // hardcoded provider there is no second issuer to be confused with, so this is belt-and-braces
    // that costs nothing and starts working for free if the Lab adds the parameter.
    const iss = url.searchParams.get('iss');
    if (iss && iss.replace(/\/+$/, '') !== config.issuer) return fail('issuer_mismatch');

    const code = url.searchParams.get('code') ?? '';
    if (!code) return fail('missing_code');

    let identity;
    try {
      identity = await exchangeCode(config, code, tx);
    } catch (error) {
      return fail(error instanceof OidcError ? error.code : 'exchange_failed');
    }

    const created = await createSession(c.env.DB, {
      userId: identity.userId,
      oidcSid: identity.sid,
      uaSummary: summarizeUserAgent(c.req.header('User-Agent')),
    });

    // A flow that began as a full-page navigation goes straight back where it started — rendering
    // a "you can close this window" page to someone whose only window this is would be absurd.
    if (tx.mode === 'redirect') {
      const headers = new Headers({ Location: tx.ret, 'Cache-Control': 'no-store' });
      headers.append('Set-Cookie', buildSessionCookie(url, created.token, created.maxAgeSeconds));
      headers.append('Set-Cookie', clearTxCookie(url));
      return new Response(null, { status: 302, headers });
    }

    const response = htmlResponse(
      closingPage({ nonce, ok: true, error: null, ret: tx.ret, eventKey: AUTH_EVENT_KEY }),
      nonce
    );
    response.headers.append('Set-Cookie', buildSessionCookie(url, created.token, created.maxAgeSeconds));
    response.headers.append('Set-Cookie', clearTxCookie(url));
    return response;
  });

  // -------------------------------------------------------------------------
  // session state
  // -------------------------------------------------------------------------

  /**
   * Who-am-I. Replaces the credentialed cross-origin call to the Lab's /api/account that the old
   * shared-cookie design relied on; that call cannot work any more, by design (the Lab reverted to
   * strict same-origin CSRF checks and dropped its CORS allowances).
   *
   * This is also the one route that re-issues the session cookie. It is the right place because it
   * is the call the frontend makes on every page load, so the re-issue window is consumed by a
   * request that is definitely able to act on it — the mistake documented in session.ts's
   * COOKIE_REISSUE_AFTER_MS comment is stamping `cookie_issued_at` forward from a request that
   * never sends a cookie.
   */
  app.get('/session', async (c) => {
    const url = new URL(c.req.url);
    const token = parseSessionCookie(c.req.header('Cookie'), url);
    const session = await validateSession(c.env.DB, token, { canIssueCookie: true });

    if (!session) {
      // 200, not 401: "nobody is signed in" is a successful answer to this question, and a 401
      // here would train the frontend's error handling to treat the normal logged-out case as a
      // failure.
      return c.json({ loggedIn: false });
    }

    const sessions = await listSessions(c.env.DB, session.userId, session.sessionId);
    const body = {
      loggedIn: true,
      userId: session.userId,
      email: session.email,
      sessions: sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        device: s.uaSummary,
        current: s.current,
      })),
    };

    const response = c.json(body);
    if (session.shouldReissueCookie && token) {
      // Max-Age tracks IDLE_MS, not ABSOLUTE_MS, for the reason `createSession` spells out: a
      // cookie outliving the idle window keeps presenting a token the server always rejects, so
      // the user looks signed in until the first request that actually needs the session fails.
      response.headers.append(
        'Set-Cookie',
        buildSessionCookie(url, token, Math.floor(IDLE_MS / 1000))
      );
    }
    return response;
  });

  // -------------------------------------------------------------------------
  // logout
  // -------------------------------------------------------------------------

  /** Ends this device's session only. */
  app.post('/logout', async (c) => {
    const url = new URL(c.req.url);
    const token = parseSessionCookie(c.req.header('Cookie'), url);
    const session = await validateSession(c.env.DB, token);
    if (session) {
      await revokeSession(c.env.DB, session.sessionId);
    }
    // Clear the cookie either way. If the row was already gone the browser is still holding a
    // useless token, and leaving it there means the user keeps looking signed in.
    const response = c.json({ ok: true });
    response.headers.append('Set-Cookie', clearSessionCookie(url));
    return response;
  });

  /**
   * Ends this account's sessions on every device, including this one.
   *
   * SCOPE, stated precisely because the name overpromises: this revokes every session THIS SITE
   * holds for the account. It does not reach into lab.integrauth.com — under the OIDC design this
   * site has no credential permitting it to, and that is the intended boundary, not a gap. The
   * reverse direction does work: when the user signs out at the Lab, its back-channel logout call
   * revokes the matching session here (see /backchannel-logout below). The account panel therefore
   * links to the Lab for account-wide sign-out, rather than implying this button covers both.
   */
  app.post('/logout-all', async (c) => {
    const url = new URL(c.req.url);
    const token = parseSessionCookie(c.req.header('Cookie'), url);
    const session = await validateSession(c.env.DB, token);
    if (!session) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const revoked = await revokeSessionsByUser(c.env.DB, session.userId);
    const response = c.json({ ok: true, revoked });
    response.headers.append('Set-Cookie', clearSessionCookie(url));
    return response;
  });

  /** Ends one named session — the per-row button in the device list. */
  app.post('/sessions/revoke', async (c) => {
    const url = new URL(c.req.url);
    const token = parseSessionCookie(c.req.header('Cookie'), url);
    const session = await validateSession(c.env.DB, token);
    if (!session) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const target =
      typeof body === 'object' && body !== null
        ? (body as { sessionId?: unknown }).sessionId
        : undefined;
    if (typeof target !== 'string' || !target) {
      return c.json({ error: 'invalid_session_id' }, 400);
    }

    // Ownership check before acting: the session id is a value the browser was handed, so without
    // this the route is an IDOR that lets any signed-in learner revoke a stranger's session.
    if (!(await sessionBelongsToUser(c.env.DB, target, session.userId))) {
      return c.json({ error: 'not_found' }, 404);
    }

    await revokeSession(c.env.DB, target);

    const response = c.json({ ok: true, self: target === session.sessionId });
    if (target === session.sessionId) {
      response.headers.append('Set-Cookie', clearSessionCookie(url));
    }
    return response;
  });

  /**
   * OIDC Back-Channel Logout 1.0 receiver — how "sign out everywhere" reaches this site from the
   * Lab, and the only unauthenticated POST in this Worker.
   *
   * Operational notes that shaped this handler: the Lab delivers ONE attempt, with a 5-second
   * timeout and no retry, and it discards our response body entirely (it records only whether the
   * status was 2xx). So this must be fast, must not depend on anything slow, and must not report
   * "nothing to do" as an error — a request whose `sid` matches no row here is the normal case for
   * a user who never signed in on this site, and returning non-2xx for it would just make the
   * Lab's audit log wrong.
   */
  app.post('/backchannel-logout', async (c) => {
    const url = new URL(c.req.url);
    const config = rpConfigFromEnv(c.env, url);
    if (!config) {
      return c.json({ error: 'not_configured' }, 503);
    }

    const contentType = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/x-www-form-urlencoded') {
      return c.json({ error: 'unsupported_media_type' }, 415);
    }

    let logoutToken: string | null = null;
    try {
      const form = await c.req.formData();
      const value = form.get('logout_token');
      logoutToken = typeof value === 'string' ? value : null;
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }
    if (!logoutToken) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    let claims;
    try {
      claims = await verifyLogoutToken(config, logoutToken);
    } catch (error) {
      return c.json({ error: error instanceof OidcError ? error.code : 'invalid_logout_token' }, 400);
    }

    // Prefer `sid`: it identifies the ONE login being ended, which is what a single-session logout
    // means. Falling back to `sub` (revoking every session for the user) is only correct when the
    // provider omitted `sid`, i.e. when it is telling us about the account rather than a session.
    let revoked = 0;
    if (claims.sid) {
      revoked = await revokeSessionsBySid(c.env.DB, claims.sid);
    } else if (claims.sub) {
      revoked = await revokeSessionsByUser(c.env.DB, claims.sub);
    }

    // 200 with a count, including when the count is zero — see the doc comment.
    return c.json({ ok: true, revoked });
  });

  return app;
}

export type AuthApp = ReturnType<typeof createAuthApp>;

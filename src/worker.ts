// Worker entry point (main = "src/worker.ts" in wrangler.toml).
//
// Routing, in order:
//   /api/academy/*  → the Academy JSON API (api.ts)
//   /auth/*         → this site's OIDC Relying Party + session lifecycle (auth.ts)
//   everything else → the static site via the ASSETS binding (the same files GitHub Pages serves)
//
// Security headers are stamped on every response either way. Keep the path prefixes here in sync
// with `run_worker_first` in wrangler.toml — a prefix handled here but missing there is served by
// the asset server instead and never reaches this code at all, which fails as a 404 rather than as
// anything that would draw attention.

import { createApp } from './lib/server/api';
import { createAuthApp } from './lib/server/auth';
import { withSecurityHeaders } from './lib/server/security';
import type { Env } from './lib/server/env';

const app = createApp();
const authApp = createAuthApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      // Last-resort catch. Both sub-apps register their own `onError` (api.ts returns JSON;
      // auth.ts renders the closing page so a popup can report the failure to its opener), so this
      // only fires for a throw that escapes routing itself or comes from env.ASSETS.fetch — and
      // without it, such a
      // throw renders Cloudflare's default error page, which carries NONE of the security headers
      // below (no HSTS, no nosniff, no COOP, no frame-deny). Nothing about the error is echoed to
      // the client — but it IS logged, or a recurring assets/routing failure would be uniform
      // opaque 500s with nothing in `wrangler tail` to diagnose them by.
      console.error('unhandled error in worker routing:', error);
      return withSecurityHeaders(
        new Response(JSON.stringify({ error: 'internal_error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        }),
        false
      );
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/academy/')) {
      const response = await app.fetch(request, env, ctx);
      // Remember any Cache-Control the route chose for itself BEFORE the wrapper overwrites it
      // (see below).
      const routeCacheControl = response.headers.get('Cache-Control');

      const secured = withSecurityHeaders(response, true);

      // `withSecurityHeaders(_, true)` pins `Cache-Control: no-store` on every API response, which
      // is right for all of them but one: the JWKS endpoint publishes static public key material
      // for a key that never rotates, and making every verifier re-fetch it uncached would be
      // pointless load. So a route that sets its own Cache-Control keeps it, and everything else —
      // every session-scoped route, which is all the rest — still gets no-store by default.
      if (routeCacheControl) {
        secured.headers.set('Cache-Control', routeCacheControl);
      }
      return secured;
    }

    // No bare-`/auth` clause: `run_worker_first = ["/auth/*"]` does not match the bare path, so the
    // asset server answers it (with the 404 page) and it can never reach this code anyway.
    if (url.pathname.startsWith('/auth/')) {
      const response = await authApp.fetch(request, env, ctx);
      const routeCacheControl = response.headers.get('Cache-Control');

      // Only the BASE header set here, not the API variant. Two of these routes redirect and one
      // renders an HTML page with an inline script, so the API CSP (`default-src 'none'`) would
      // break them; that page ships its own nonce-based CSP instead, and `withSecurityHeaders`
      // leaves an existing Content-Security-Policy alone when `isApiResponse` is false.
      const secured = withSecurityHeaders(response, false);

      // NOTHING under /auth/* is ever cacheable: /session returns the caller's own email and device
      // list, and the rest mutate session state. Individual routes DO set `no-store` themselves
      // (the redirects and the HTML pages), but relying on that alone was a real gap — /session,
      // /logout, /logout-all, /sessions/revoke and /backchannel-logout each shipped no
      // Cache-Control at all, so a 200 JSON body with no directives and no Expires is eligible for
      // *heuristic* freshness in a shared forward proxy, which is one user's identity served to
      // another. Default it here so a future route cannot forget, while still letting a route
      // override (same pattern as the /api/academy/* branch above).
      if (!routeCacheControl) {
        secured.headers.set('Cache-Control', 'no-store');
      }
      return secured;
    }

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response, false);
  }
}

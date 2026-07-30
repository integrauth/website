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

    if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) {
      const response = await authApp.fetch(request, env, ctx);

      // Only the BASE header set here, not the API variant. Two of these routes redirect and one
      // renders an HTML page with an inline script, so the API CSP (`default-src 'none'`) would
      // break them; that page ships its own nonce-based CSP instead, and `withSecurityHeaders`
      // leaves an existing Content-Security-Policy alone when `isApiResponse` is false. Every
      // /auth route sets its own `Cache-Control: no-store`.
      return withSecurityHeaders(response, false);
    }

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response, false);
  },
} satisfies ExportedHandler<Env>;

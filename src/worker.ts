// Worker entry point (main = "src/worker.ts" in wrangler.toml).
//
// Routing: anything under /api/academy/* goes to the Hono app; everything else is
// served from the static site via the ASSETS binding (same files GitHub Pages
// serves today). Security headers are stamped on every response either way.

import { createApp } from './lib/server/api';
import { withSecurityHeaders } from './lib/server/security';
import type { Env } from './lib/server/env';

const app = createApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const isApiRequest = url.pathname.startsWith('/api/academy/');

    if (isApiRequest) {
      const response = await app.fetch(request, env, ctx);
      // Remember any Cache-Control the route chose for itself BEFORE the wrapper
      // overwrites it (see below).
      const routeCacheControl = response.headers.get('Cache-Control');

      const secured = withSecurityHeaders(response, true);

      // `withSecurityHeaders(_, true)` pins `Cache-Control: no-store` on every API
      // response, which is right for all of them but one: the JWKS endpoint publishes
      // static public key material for a key that never rotates, and making every
      // verifier re-fetch it uncached would be pointless load. So a route that sets its
      // own Cache-Control gets to keep it, and everything else — every session-scoped
      // route, which is all the rest — still gets no-store by default.
      if (routeCacheControl) {
        secured.headers.set('Cache-Control', routeCacheControl);
      }
      return secured;
    }

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response, false);
  },
} satisfies ExportedHandler<Env>;

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
      return withSecurityHeaders(response, true);
    }

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response, false);
  },
} satisfies ExportedHandler<Env>;

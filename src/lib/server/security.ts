// Security headers applied to every response this Worker serves.
//
// Unlike the sister `integrauth/lab` repo (a SvelteKit build that controls CSP on a
// per-page basis), this is a static HTML site that already loads Bootstrap, Font
// Awesome, jQuery, and Google Fonts from CDNs plus inline <script> boot-loader code
// (see CLAUDE.md's "Boot loader & async CDN CSS" section) with NO existing CSP
// infrastructure. Inventing a strict default CSP for HTML here would very likely
// break those pages. So: the strict baseline (HSTS, nosniff, frame-deny, etc.) is
// applied to ALL responses, but a strict default `Content-Security-Policy` is only
// added to our own same-origin JSON API responses (/api/academy/*) — HTML/asset
// responses served via ASSETS.fetch() are left exactly as they are today.

// KEEP IN SYNC with the `_headers` file at the repo root, which applies this same set to STATIC
// responses (wrangler.toml scopes run_worker_first to /api/academy/*, so static requests never
// reach this Worker). HSTS deliberately omits `preload` — see _headers for why.
const BASE_SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy':
    'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), sync-xhr=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

// Applied only to JSON API responses — locked down since we fully control the shape
// of those responses and they never need third-party scripts/styles/frames.
const API_CONTENT_SECURITY_POLICY =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

/** Mutates and returns `headers` with the baseline security header set applied. */
export function applySecurityHeaders(headers: Headers): Headers {
  for (const [key, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return headers;
}

/** Adds the strict default CSP used for our own JSON API responses only. */
export function applyApiContentSecurityPolicy(headers: Headers): Headers {
  headers.set('Content-Security-Policy', API_CONTENT_SECURITY_POLICY);
  return headers;
}

/**
 * Wraps a Response, returning a new Response with security headers applied.
 * `isApiResponse` additionally pins the strict JSON CSP + no-store caching —
 * every /api/academy/* route is session-scoped or a fast-changing public lookup,
 * so responses should never be cached.
 */
export function withSecurityHeaders(response: Response, isApiResponse: boolean): Response {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers);
  if (isApiResponse) {
    applyApiContentSecurityPolicy(headers);
    headers.set('Cache-Control', 'no-store');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

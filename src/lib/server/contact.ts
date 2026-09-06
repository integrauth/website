// Contact form: POST /api/contact
//
// Turnstile-verified, then relayed by email via Resend. No storage — a message that fails to send
// is reported to the sender as an error, never silently dropped into a table nobody reads.
//
// Unset RESEND_API_KEY / TURNSTILE_SECRET_KEY ⇒ 503 `contact_unavailable`, and the page falls back
// to the mailto link. No per-IP rate limit here for the same reason as api.ts (no DO/KV); Turnstile
// is the abuse guard, and every send costs the caller a solved challenge.

import { Hono, type MiddlewareHandler } from 'hono';
import type { Env } from './env';
import { isAllowedOrigin } from './api';

import { DEFAULT_FROM, DEFAULT_TO, str, validateContact, type ContactMessage } from './contact-validate';

async function verifyTurnstile(secret: string, token: string, ip: string | undefined): Promise<boolean> {
  const form = new FormData();
  form.set('secret', secret);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) return false;
  const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
  return data?.success === true;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}

async function sendViaResend(env: Env, m: ContactMessage): Promise<boolean> {
  const subject = `[integrauth.com] ${m.name}${m.company ? ` (${m.company})` : ''}`;
  const text = [
    `Name: ${m.name}`,
    `Email: ${m.email}`,
    `Company: ${m.company || '-'}`,
    '',
    m.message,
  ].join('\n');
  const html = `<p><b>Name:</b> ${escapeHtml(m.name)}<br><b>Email:</b> ${escapeHtml(m.email)}<br><b>Company:</b> ${escapeHtml(m.company || '-')}</p><pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(m.message)}</pre>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.CONTACT_FROM || DEFAULT_FROM,
      to: [env.CONTACT_TO || DEFAULT_TO],
      reply_to: m.email,
      subject,
      text,
      html,
    }),
  });
  if (!res.ok) console.error('resend error', res.status, await res.text().catch(() => ''));
  return res.ok;
}

type AppEnv = { Bindings: Env };

export function createContactApp() {
  const app = new Hono<AppEnv>().basePath('/api/contact');

  // Same CSRF posture as api.ts: browser Origin allowlist + JSON only.
  const guard: MiddlewareHandler<AppEnv> = async (c, next) => {
    const origin = c.req.header('Origin');
    if (!origin || !isAllowedOrigin(origin, new URL(c.req.url))) {
      return c.json({ error: 'forbidden_origin' }, 403);
    }
    const mediaType = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (mediaType !== 'application/json') return c.json({ error: 'unsupported_media_type' }, 415);
    return next();
  };

  app.post('/', guard, async (c) => {
    if (!c.env.RESEND_API_KEY || !c.env.TURNSTILE_SECRET_KEY) {
      return c.json({ error: 'contact_unavailable' }, 503);
    }
    const body = await c.req.json().catch(() => null);
    const v = validateContact(body);
    if (!v.ok) return c.json({ error: v.error }, 400);

    const token = str((body as Record<string, unknown>).turnstileToken);
    if (!token || token.length > 2048) return c.json({ error: 'captcha_required' }, 400);
    const human = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, token, c.req.header('CF-Connecting-IP'));
    if (!human) return c.json({ error: 'captcha_failed' }, 400);

    const sent = await sendViaResend(c.env, v.value);
    if (!sent) return c.json({ error: 'send_failed' }, 502);
    return c.json({ ok: true });
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error('contact api error', err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

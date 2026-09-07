// Pure input validation for the contact form. Kept free of Hono/api imports so `node --test`
// can load it directly (tests/contact-validate.test.mjs).

const MAX_NAME = 120;
const MAX_COMPANY = 160;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 4000;
export const DEFAULT_TO = 'akhil@integrauth.com';
export const DEFAULT_FROM = 'IntegrAuth Website <no-reply@mail.integrauth.com>';

export interface ContactMessage {
  name: string;
  email: string;
  company: string;
  message: string;
}

export type ContactValidation = { ok: true; value: ContactMessage } | { ok: false; error: string };

export function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// Deliberately loose: one @, something either side, no whitespace. Deliverability is Resend's
// problem; this only stops garbage from becoming a Reply-To header.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Header-injection guard for the values that land in Reply-To / Subject.
const CONTROL_RE = /[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

export function validateContact(body: unknown): ContactValidation {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid_body' };
  const b = body as Record<string, unknown>;
  // Honeypot: bots fill every field; humans never see this one.
  if (str(b.website)) return { ok: false, error: 'invalid_body' };

  const name = str(b.name);
  const email = str(b.email);
  const company = str(b.company);
  const message = str(b.message);

  if (!name || name.length > MAX_NAME || CONTROL_RE.test(name)) return { ok: false, error: 'invalid_name' };
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email) || CONTROL_RE.test(email)) {
    return { ok: false, error: 'invalid_email' };
  }
  if (company.length > MAX_COMPANY || CONTROL_RE.test(company)) return { ok: false, error: 'invalid_company' };
  if (message.length < 10 || message.length > MAX_MESSAGE) return { ok: false, error: 'invalid_message' };

  return { ok: true, value: { name, email, company, message } };
}


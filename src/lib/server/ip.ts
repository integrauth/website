// Turning a request's client IP into a counting key for the final-exam rate limit.
//
// WHY A HASH AND NOT THE ADDRESS. The only question anything asks of this value is "have I seen this
// network in the last 24 hours?", which equality answers and the address itself is not needed for.
// Storing the address would put a directly identifying, indefinitely-retained data point in a
// database shared with the Lab app, for no capability we use. So the address is hashed on the way in,
// the hash is what lands in `academy_exam_attempts.ip_hash`, and the row's hash is erased once it
// ages out of the counting window (see `scrubExamAttemptIpHashesBefore` in store.ts).
//
// WHAT THIS IS NOT. It is not anonymisation and must not be described as such anywhere. IPv4 has only
// 2^32 addresses, so an UNPEPPERED SHA-256 of one is reversible by exhaustive search in seconds by
// anyone holding the hash. What the hash genuinely buys, unpeppered, is that the value is useless
// without deliberate effort and cannot be read off a row or a log line at a glance. EXAM_IP_HASH_PEPPER
// upgrades it to a keyed HMAC, which IS unrecoverable without the key, and the deploy workflow
// provisions that secret (mirroring a GitHub Secret of the same name, or generating one if absent),
// so a deployed Worker is peppered. It stays OPTIONAL in the code rather than required for two
// reasons: a missing pepper must not take the exam offline, and local development has no secret
// store. Rotating it is cheap — it re-buckets everyone and resets the in-flight 24-hour counts once,
// and nothing durable is derived from it.
//
// SPOOFING. `CF-Connecting-IP` is set by Cloudflare's edge on every request that reaches a Worker,
// overwriting anything the client sent under that name, so it cannot be forged by a caller. That is
// why it is read alone: `X-Forwarded-For` is client-controlled at the first hop and would let anyone
// pick their own rate-limit bucket, which is worse than having no limit — it would look like one.

/** Domain separator, so this hash can never collide with one computed for any other purpose. */
export const EXAM_IP_HASH_DOMAIN = 'integrauth-academy-exam-ip-v1';

/**
 * The bucket used when Cloudflare did not give us a client IP — i.e. local development, and nothing
 * else in practice.
 *
 * Requests with no address share ONE bucket rather than skipping the limit. That is deliberate and
 * is the fail-CLOSED choice: if the header ever went missing in production, sharing a bucket
 * over-limits (annoying, visible, recoverable) whereas skipping the check silently removes the limit
 * with nothing to notice. It cannot be used as a bypass either, since a caller cannot cause the
 * header to be absent.
 */
export const UNKNOWN_IP = 'unknown';

/** Normalises the `CF-Connecting-IP` header into a non-empty bucket name. */
export function clientIpFromHeader(headerValue: string | null | undefined): string {
  const value = (headerValue ?? '').trim();
  return value === '' ? UNKNOWN_IP : value;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hex SHA-256 (or HMAC-SHA-256, when a pepper is configured) of the client IP.
 *
 * Stable for a given (ip, pepper) pair — the whole point, since two attempts from one network must
 * produce one key — and therefore ALSO stable across a pepper change only for as long as the pepper
 * is unchanged: rotating it resets everyone's in-flight 24-hour count once. That is acceptable and
 * is noted here so a rotation is not mistaken for a broken limit.
 */
export async function hashClientIp(ip: string, pepper?: string): Promise<string> {
  const encoder = new TextEncoder();
  const message = encoder.encode(`${EXAM_IP_HASH_DOMAIN}:${ip}`);
  if (pepper) {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(pepper),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    return toHex(await crypto.subtle.sign('HMAC', key, message));
  }
  return toHex(await crypto.subtle.digest('SHA-256', message));
}

/**
 * Client IP resolution for rate limiting and abuse controls.
 *
 * The app runs on Fly.io behind the Cloudflare proxy, so every request
 * carries proxy headers. Order matters: `cf-connecting-ip` is set by
 * Cloudflare itself and cannot be spoofed by the client, whereas
 * `x-forwarded-for` is a client-supplied list that proxies append to.
 * Reading the first `x-forwarded-for` entry without checking
 * `cf-connecting-ip` first lets an attacker rotate the value per request
 * and bypass any per-IP limit entirely.
 */

const UNKNOWN_CLIENT = 'unknown'

export function getClientIp(headers: Headers): string | null {
  const cloudflareIp = headers.get('cf-connecting-ip')?.trim()
  if (cloudflareIp) {
    return cloudflareIp
  }

  const forwardedFor = headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim()
  if (forwardedFor) {
    return forwardedFor
  }

  return headers.get('x-real-ip')?.trim() || null
}

/**
 * Stable per-client key for rate limiting. Falls back to a shared bucket
 * when no IP is resolvable, which is deliberately conservative: unknown
 * clients share one budget rather than each receiving a fresh one.
 */
export function getClientIdentifier(headers: Headers): string {
  return getClientIp(headers) ?? UNKNOWN_CLIENT
}

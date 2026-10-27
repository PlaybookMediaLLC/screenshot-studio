/**
 * Client IP resolution for rate limiting and abuse controls.
 *
 * DigitalOcean App Platform supplies `do-connecting-ip`. Its deployment sets
 * CLIENT_IP_SOURCE so requests cannot select their own rate-limit bucket with
 * proxy headers. Other installations retain their existing proxy behavior.
 */

import { getPlatformApiEnvironment } from '@/lib/api/environment'

const UNKNOWN_CLIENT = 'unknown'

function getProxyClientIp(headers: Headers): string | null {
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

/** The client IP from the trusted proxy header for this deployment, or null. */
export function getClientIp(headers: Headers): string | null {
  if (getPlatformApiEnvironment().CLIENT_IP_SOURCE === 'digitalocean') {
    return headers.get('do-connecting-ip')?.trim() || null
  }
  return getProxyClientIp(headers)
}

/**
 * Stable per-client key for rate limiting. Falls back to a shared bucket
 * when no IP is resolvable, which is deliberately conservative: unknown
 * clients share one budget rather than each receiving a fresh one.
 */
export function getClientIdentifier(headers: Headers): string {
  return getClientIp(headers) ?? UNKNOWN_CLIENT
}

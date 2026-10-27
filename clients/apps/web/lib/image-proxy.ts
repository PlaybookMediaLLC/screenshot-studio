import { safeFetchBytes, type SafeFetchOptions } from '@/lib/launch/safe-fetch'

export const IMAGE_PROXY_HOSTS = [
  'pbs.twimg.com',
  'abs.twimg.com',
  'ton.twitter.com',
  'video.twimg.com',
]
const allowedOrigins = new Set(IMAGE_PROXY_HOSTS.map((host) => `https://${host}`))
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'])

export function isAllowedProxyImage(url: URL): boolean {
  return allowedOrigins.has(url.origin) && !url.username && !url.password
}

/** Bound every hop, DNS result, body, and media type before serving remote bytes on our origin. */
export async function fetchProxyImage(
  url: URL,
  options: Pick<SafeFetchOptions, 'resolve' | 'transport'> = {}
) {
  const result = await safeFetchBytes(url.toString(), {
    ...options,
    allowedOrigins,
    maxBytes: 10 * 1024 * 1024,
    timeoutMs: 10_000,
  })
  if (!result.ok) return result
  if (result.truncated || !imageTypes.has(result.contentType)) {
    return { ok: false as const, reason: 'The response must be a supported image under 10 MB.' }
  }
  return result
}

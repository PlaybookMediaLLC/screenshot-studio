import 'server-only'

import { rateLimitHeaders } from '@/lib/api/platform-errors'
import { LINK_PREVIEW_RATE_LIMIT } from '@/lib/api/rate-limit-policy'
import { errorResponse } from '@/lib/api/route'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * The workspace's link preview budget, shared by every route that fetches a
 * page for it. A 429 when it is spent, a 503 when the limiter is down, else
 * null. It fails closed like the screenshot API: an unmetered fetcher is an
 * open proxy.
 */
export async function linkPreviewLimit(organizationId: string): Promise<Response | null> {
  try {
    const limit = await checkRateLimit(`link-preview:${organizationId}`, LINK_PREVIEW_RATE_LIMIT)
    if (limit.allowed) return null
    const response = errorResponse(429, 'Too many link previews. Try again in a minute.')
    for (const [name, value] of Object.entries(rateLimitHeaders(limit.limit, limit.resetAt))) {
      response.headers.set(name, value)
    }
    return response
  } catch (error) {
    console.error('Link preview rate limit check failed:', error)
    return errorResponse(503, 'Link previews are unavailable. Try again shortly.')
  }
}

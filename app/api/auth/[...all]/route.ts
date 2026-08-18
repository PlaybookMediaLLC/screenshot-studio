import { toNextJsHandler } from 'better-auth/next-js'
import { getClientIdentifier } from '@/lib/api/client-identity'
import { AuthorizationError } from '@/lib/auth/access'
import { assertAuthEnvironment } from '@/lib/auth/environment'
import {
  authorizeEnterpriseAuthRequest,
  logEnterpriseAuthRequest,
} from '@/lib/auth/enterprise-guard'
import { auth } from '@/lib/auth/server'
import { AUTH_RATE_LIMIT } from '@/lib/api/rate-limit-policy'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * Only credential-bearing endpoints are throttled. Session reads run on
 * every page load, so limiting them would break normal browsing, and they
 * are not a credential-guessing surface.
 */
const RATE_LIMITED_AUTH_PATHS = [
  '/sign-in',
  '/sign-up',
  '/forget-password',
  '/reset-password',
  '/change-password',
  '/two-factor',
]

function isRateLimitedAuthRequest(request: Request): boolean {
  if (request.method !== 'POST') {
    return false
  }

  const { pathname } = new URL(request.url)
  return RATE_LIMITED_AUTH_PATHS.some((path) => pathname.includes(path))
}

function getRateLimitResponse(resetAt: number): Response {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
  return Response.json(
    { error: 'Too many attempts. Please try again shortly.' },
    {
      headers: {
        'Retry-After': retryAfter.toString(),
        'X-RateLimit-Limit': AUTH_RATE_LIMIT.maxRequests.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': resetAt.toString(),
      },
      status: 429,
    }
  )
}

/**
 * Returns a 429 when the caller is over budget, or null to continue.
 *
 * A Redis outage must not lock every user out of signing in, so a failed
 * check is logged and allowed through. The tradeoff is deliberate:
 * availability of authentication is worth more than throttling during the
 * window where the cache is unreachable.
 */
async function enforceAuthRateLimit(request: Request): Promise<Response | null> {
  if (!isRateLimitedAuthRequest(request)) {
    return null
  }

  try {
    const rateLimit = await checkRateLimit(getClientIdentifier(request.headers), AUTH_RATE_LIMIT)
    return rateLimit.allowed ? null : getRateLimitResponse(rateLimit.resetAt)
  } catch (error) {
    console.error('Auth rate limit check failed; allowing request.', error)
    return null
  }
}

const handler = toNextJsHandler({
  handler: async (request: Request): Promise<Response> => {
    try {
      assertAuthEnvironment()

      const rateLimited = await enforceAuthRateLimit(request)
      if (rateLimited) {
        return rateLimited
      }

      const enterpriseRequest = await authorizeEnterpriseAuthRequest(request)
      const response = await auth.handler(request)
      if (enterpriseRequest && response.ok) {
        try {
          await logEnterpriseAuthRequest(request, enterpriseRequest)
        } catch (error) {
          console.error('Enterprise identity audit write failed.', error)
        }
      }
      return response
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return Response.json({ error: error.message }, { status: error.status })
      }

      throw error
    }
  },
})

export const { DELETE, GET, PATCH, POST, PUT } = handler

import { toNextJsHandler } from 'better-auth/next-js'
import { Prisma } from '@prisma/client'
import { getClientIdentifier } from '@/lib/api/client-identity'
import { AuthorizationError, resolveActiveOrganizationId } from '@/lib/auth/access'
import { assertAuthEnvironment } from '@/lib/auth/environment'
import {
  authorizeEnterpriseAuthRequest,
  logEnterpriseAuthRequest,
} from '@/lib/auth/enterprise-guard'
import { auth } from '@/lib/auth/server'
import {
  AUTH_RATE_LIMIT,
  type RateLimitPolicy,
  WORKSPACE_INVITATION_RATE_LIMIT,
} from '@/lib/api/rate-limit-policy'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { isWorkspaceOperational } from '@/lib/workspace/access'

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

const OPERATIONAL_ORGANIZATION_PATHS = [
  '/organization/add-member',
  '/organization/get-active-member',
  '/organization/get-full-organization',
  '/organization/invite-member',
  '/organization/leave',
  '/organization/list-invitations',
  '/organization/list-members',
  '/organization/remove-member',
  '/organization/set-active',
  '/organization/update',
  '/organization/update-member-role',
]

type OrganizationRequestInput = { organizationId?: unknown; organizationSlug?: unknown }

async function getOrganizationRequestInput(request: Request): Promise<OrganizationRequestInput> {
  if (request.method === 'GET') {
    const searchParams = new URL(request.url).searchParams
    return {
      organizationId: searchParams.get('organizationId') ?? undefined,
      organizationSlug: searchParams.get('organizationSlug') ?? undefined,
    }
  }

  try {
    const body = (await request.clone().json()) as OrganizationRequestInput
    return body && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

async function resolveRequestedOrganizationId(
  input: OrganizationRequestInput,
  activeOrganizationId: string | null | undefined
): Promise<string | null> {
  if (typeof input.organizationId === 'string') return input.organizationId
  if (typeof input.organizationSlug === 'string') {
    return (
      (
        await prisma.organization.findUnique({
          select: { id: true },
          where: { slug: input.organizationSlug },
        })
      )?.id ?? null
    )
  }
  return activeOrganizationId ?? null
}

async function getRequestedWorkspaceId(request: Request): Promise<string | null> {
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  })
  if (!session) return null

  const input = await getOrganizationRequestInput(request)
  const organizationId = await resolveRequestedOrganizationId(
    input,
    session.session.activeOrganizationId
  )
  if (!organizationId) return null

  const membership = await prisma.member.findUnique({
    select: { organizationId: true },
    where: { organizationId_userId: { organizationId, userId: session.user.id } },
  })
  return membership?.organizationId ?? null
}

async function enforceOperationalOrganization(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!OPERATIONAL_ORGANIZATION_PATHS.some((path) => pathname.endsWith(path))) {
    return null
  }

  const organizationId = await getRequestedWorkspaceId(request)
  if (organizationId && !(await isWorkspaceOperational(organizationId))) {
    return Response.json({ error: 'This workspace is unavailable.' }, { status: 403 })
  }
  return null
}

async function ensureActiveOrganizationForSessionRead(request: Request): Promise<void> {
  if (!new URL(request.url).pathname.endsWith('/get-session')) {
    return
  }

  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  })
  if (session) {
    await resolveActiveOrganizationId(session.session, session.user.id)
  }
}

function getAuthRateLimitPolicy(request: Request): RateLimitPolicy | null {
  if (request.method !== 'POST') {
    return null
  }

  const { pathname } = new URL(request.url)
  if (pathname.includes('/organization/invite-member')) {
    return WORKSPACE_INVITATION_RATE_LIMIT
  }
  return RATE_LIMITED_AUTH_PATHS.some((path) => pathname.includes(path)) ? AUTH_RATE_LIMIT : null
}

function getRateLimitResponse(policy: RateLimitPolicy, resetAt: number): Response {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
  return Response.json(
    { error: 'Too many attempts. Please try again shortly.' },
    {
      headers: {
        'Retry-After': retryAfter.toString(),
        'X-RateLimit-Limit': policy.maxRequests.toString(),
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
  const policy = getAuthRateLimitPolicy(request)
  if (!policy) {
    return null
  }

  try {
    const rateLimit = await checkRateLimit(getClientIdentifier(request.headers), policy)
    return rateLimit.allowed ? null : getRateLimitResponse(policy, rateLimit.resetAt)
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

      const unavailableWorkspace = await enforceOperationalOrganization(request)
      if (unavailableWorkspace) {
        return unavailableWorkspace
      }

      await ensureActiveOrganizationForSessionRead(request)

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

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return Response.json({ error: 'This record already exists.' }, { status: 409 })
      }

      throw error
    }
  },
})

export const { DELETE, GET, PATCH, POST, PUT } = handler

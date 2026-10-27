import { randomUUID } from 'node:crypto'
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api'
import { BackendSDKError } from 'screenshot-studio-backend-sdk'
import { z } from 'zod'
import { backendSDK } from '@/lib/backend/sdk'

const id = z.string().min(1).max(128)
const responseInput = z.strictObject({ invitationId: id })
const actorSession = z.object({
  session: z.object({ id, activeOrganizationId: z.string().nullish() }),
  user: z.object({ id, email: z.string() }),
})
const invitationInput = z.strictObject({
  email: z.email().max(320),
  role: z.enum([
    'admin',
    'creator',
    'approver',
    'publisher',
    'writer_publisher',
    'viewer',
    'member',
  ]),
  organizationId: id.optional(),
  resend: z.boolean().optional(),
})

function invitationBackend(value: unknown, organizationId?: string) {
  const { session, user } = actorSession.parse(value)
  return backendSDK({
    organizationId: organizationId ?? session.activeOrganizationId ?? '',
    requestId: randomUUID(),
    principal: { kind: 'session', sessionId: session.id, userId: user.id, display: user.email },
  })
}

async function invitationResult<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof BackendSDKError) {
      const status = {
        400: 'BAD_REQUEST',
        401: 'UNAUTHORIZED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        429: 'TOO_MANY_REQUESTS',
      } as const
      const code = status[error.status as keyof typeof status]
      if (code)
        throw APIError.fromStatus(code, {
          message:
            error.status === 404
              ? 'This invitation is unavailable for this account.'
              : error.message,
        })
    }
    throw APIError.fromStatus('SERVICE_UNAVAILABLE', {
      message: 'The invitation result was not confirmed. Refresh its status before trying again.',
    })
  }
}

// Replacing the plugin endpoints covers both HTTP and auth.api server calls.
// Better Auth keeps its session/origin protections; Go owns each transaction.
const createInvitation = createAuthEndpoint(
  '/organization/invite-member',
  {
    method: 'POST',
    body: invitationInput,
    requireHeaders: true,
    use: [sessionMiddleware],
  },
  async (ctx) =>
    ctx.json(
      await invitationResult(async () => {
        const backend = invitationBackend(ctx.context.session, ctx.body.organizationId)
        const email = ctx.body.email.toLowerCase()
        if (ctx.body.resend) {
          const { invitations } = await backend.listWorkspaceInvitations()
          const existing = invitations.find((item) => item.email.toLowerCase() === email)
          if (existing) return backend.resendWorkspaceInvitation(existing.id)
        }
        return backend.inviteWorkspaceMember({
          email,
          role: ctx.body.role === 'member' ? 'viewer' : ctx.body.role,
        })
      })
    )
)

const acceptInvitation = createAuthEndpoint(
  '/organization/accept-invitation',
  {
    method: 'POST',
    body: responseInput,
    requireHeaders: true,
    use: [sessionMiddleware],
  },
  async (ctx) =>
    ctx.json(
      await invitationResult(() =>
        invitationBackend(ctx.context.session).respondWorkspaceInvitation(
          ctx.body.invitationId,
          'accept'
        )
      )
    )
)

const rejectInvitation = createAuthEndpoint(
  '/organization/reject-invitation',
  {
    method: 'POST',
    body: responseInput,
    requireHeaders: true,
    use: [sessionMiddleware],
  },
  async (ctx) =>
    ctx.json(
      await invitationResult(() =>
        invitationBackend(ctx.context.session).respondWorkspaceInvitation(
          ctx.body.invitationId,
          'reject'
        )
      )
    )
)

const cancelInvitation = createAuthEndpoint(
  '/organization/cancel-invitation',
  {
    method: 'POST',
    body: responseInput,
    requireHeaders: true,
    use: [sessionMiddleware],
  },
  async (ctx) =>
    ctx.json(
      await invitationResult(() =>
        invitationBackend(ctx.context.session).cancelWorkspaceInvitation(ctx.body.invitationId)
      )
    )
)

const getInvitation = createAuthEndpoint(
  '/organization/get-invitation',
  {
    method: 'GET',
    query: z.strictObject({ id }),
    requireHeaders: true,
    use: [sessionMiddleware],
  },
  async (ctx) =>
    ctx.json(
      await invitationResult(() =>
        invitationBackend(ctx.context.session).getRecipientInvitation(ctx.query.id)
      )
    )
)

/** The canonical invitation endpoints within Better Auth's organization plugin. */
export const workspaceInvitationEndpoints = {
  createInvitation,
  acceptInvitation,
  rejectInvitation,
  cancelInvitation,
  getInvitation,
}

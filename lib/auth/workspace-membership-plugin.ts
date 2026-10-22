import { randomUUID } from 'node:crypto'
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api'
import { BackendSDKError, type WorkspaceMember } from 'screenshot-studio-backend-sdk'
import { z } from 'zod'
import { backendSDK } from '@/lib/backend/sdk'

const id = z.string().min(1).max(128)
const actorSession = z.object({
  session: z.object({ id, activeOrganizationId: id.nullish() }),
  user: z.object({ id, email: z.string() }),
})
const assignableRole = z.enum([
  'admin',
  'creator',
  'approver',
  'publisher',
  'writer_publisher',
  'viewer',
  'member',
])

function membershipBackend(value: unknown, organizationId?: string) {
  const { session, user } = actorSession.parse(value)
  return backendSDK({
    organizationId: organizationId ?? session.activeOrganizationId ?? '',
    requestId: randomUUID(),
    principal: { kind: 'session', sessionId: session.id, userId: user.id, display: user.email },
  })
}

async function membershipResult<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof APIError) throw error
    if (error instanceof BackendSDKError) {
      switch (error.status) {
        case 400:
          throw APIError.fromStatus('BAD_REQUEST', { message: error.message })
        case 401:
          throw APIError.fromStatus('UNAUTHORIZED', { message: 'Sign in to manage membership.' })
        case 403:
          throw APIError.fromStatus('FORBIDDEN', {
            message: 'This membership action is unavailable.',
          })
        case 404:
          throw APIError.fromStatus('NOT_FOUND', { message: 'This member is unavailable.' })
        case 409:
          throw APIError.fromStatus('CONFLICT', { message: error.message })
        case 429:
          throw APIError.fromStatus('TOO_MANY_REQUESTS', { message: error.message })
      }
    }
    throw APIError.fromStatus('SERVICE_UNAVAILABLE', {
      message:
        'The membership result was not confirmed. Refresh the member list before trying again.',
    })
  }
}

function authMember(member: WorkspaceMember) {
  return {
    id: member.id,
    organizationId: member.organizationId,
    userId: member.userId,
    role: member.role,
    createdAt: new Date(member.createdAt),
  }
}

const updateMemberRole = createAuthEndpoint(
  '/organization/update-member-role',
  {
    method: 'POST',
    requireHeaders: true,
    use: [sessionMiddleware],
    body: z.strictObject({ memberId: id, role: assignableRole, organizationId: id.optional() }),
  },
  async (ctx) =>
    ctx.json(
      await membershipResult(async () => ({
        member: authMember(
          await membershipBackend(
            ctx.context.session,
            ctx.body.organizationId
          ).updateWorkspaceMemberRole(
            ctx.body.memberId,
            ctx.body.role === 'member' ? 'viewer' : ctx.body.role
          )
        ),
      }))
    )
)

const removeMember = createAuthEndpoint(
  '/organization/remove-member',
  {
    method: 'POST',
    requireHeaders: true,
    use: [sessionMiddleware],
    body: z.strictObject({
      memberIdOrEmail: z.union([id, z.email().max(320)]),
      organizationId: id.optional(),
    }),
  },
  async (ctx) =>
    ctx.json(
      await membershipResult(async () => {
        const backend = membershipBackend(ctx.context.session, ctx.body.organizationId)
        let memberId = ctx.body.memberIdOrEmail
        if (memberId.includes('@')) {
          const { members } = await backend.listWorkspaceMembers()
          const member = members.find(
            (item) => item.user.email.toLowerCase() === memberId.toLowerCase()
          )
          if (!member)
            throw APIError.fromStatus('NOT_FOUND', { message: 'This member is unavailable.' })
          memberId = member.id
        }
        // The read above resolves an email only. Go rechecks current authority and the
        // target before revoking access, committing audit and returning this snapshot.
        const result = await backend.removeWorkspaceMember(memberId)
        return { member: authMember(result.member) }
      })
    )
)

const leaveOrganization = createAuthEndpoint(
  '/organization/leave',
  {
    method: 'POST',
    requireHeaders: true,
    use: [sessionMiddleware],
    body: z.strictObject({ organizationId: id }),
  },
  async (ctx) =>
    ctx.json(
      await membershipResult(async () => {
        const result = await membershipBackend(
          ctx.context.session,
          ctx.body.organizationId
        ).leaveWorkspace()
        return authMember(result.member)
      })
    )
)

/** Better Auth and workspace controls share atomic membership commands in Go. */
export const workspaceMembershipEndpoints = { updateMemberRole, removeMember, leaveOrganization }

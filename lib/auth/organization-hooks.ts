import { APIError } from 'better-auth'
import { BackendSDKError } from 'screenshot-studio-backend-sdk'
import { WORKSPACE_INVITATION_RATE_LIMIT } from '@/lib/api/rate-limit-policy'
import { serviceBackend } from '@/lib/backend/sdk'
import { checkRateLimit } from '@/lib/rate-limit'
import { workspaceOrganizationPatchSchema } from '@/lib/workspace/schemas'
import { isSupportedOrganizationRole } from './permissions'

type OrganizationHook = { organization: { id: string } }
type MemberHook = OrganizationHook & { member: { organizationId: string; role: string } }
type OrganizationUpdateHook = {
  member: { organizationId: string }
  organization: { logo?: string | null; name?: string; slug?: string }
}
type OrganizationUpdatedHook = {
  member: { organizationId: string }
  organization: { id: string } | null
  user: { email: string; id: string }
}
type RemovedMemberHook = {
  member: { id: string; organizationId: string; role: string; userId: string }
} & OrganizationHook
type InvitationHook = {
  invitation: { email: string; id?: string; organizationId: string; role: string }
  inviter: { id: string }
} & OrganizationHook
type InvitationCreatedHook = {
  invitation: { email: string; id: string; organizationId: string; role: string }
  inviter: { email: string; id: string }
}
type InvitationAcceptedHook = {
  invitation: { id: string; organizationId: string }
  member: { id: string; userId: string }
  user: { email: string; id: string }
} & OrganizationHook
type InvitationAcceptanceHook = {
  invitation: { organizationId: string }
}
type InvitationCancelledHook = {
  cancelledBy: { email: string; id: string }
  invitation: { id: string; organizationId: string }
}
type InvitationRejectedHook = {
  invitation: { id: string; organizationId: string }
  user: { email: string; id: string }
}
type RoleUpdateHook = OrganizationHook & {
  member: { id: string; organizationId: string; role: string }
  newRole: string
}
type RoleUpdatedHook = {
  member: { id: string; organizationId: string; role: string }
}

async function requireOperationalWorkspace(organizationId: string): Promise<void> {
  if (!(await serviceBackend().isWorkspaceOperational(organizationId))) {
    throw APIError.fromStatus('FORBIDDEN', { message: 'This workspace is unavailable.' })
  }
}

/**
 * Refuses one more member when the workspace's plan seats are full. A pending
 * invitation holds a seat, so it is counted before inviting, not on accepting.
 */
async function requireSeat(organizationId: string, invitations: boolean): Promise<void> {
  try {
    await serviceBackend().requireWorkspaceSeat(organizationId, invitations)
  } catch (error) {
    if (error instanceof BackendSDKError && error.status === 403) {
      throw APIError.fromStatus('FORBIDDEN', { message: error.message })
    }
    throw error
  }
}

async function enforceInvitationRateLimit(organizationId: string, userId: string): Promise<void> {
  try {
    const result = await checkRateLimit(
      `${organizationId}:${userId}`,
      WORKSPACE_INVITATION_RATE_LIMIT
    )
    if (!result.allowed) {
      throw APIError.fromStatus('TOO_MANY_REQUESTS', {
        message: 'Too many invitation emails. Please try again later.',
      })
    }
  } catch (error) {
    if (error instanceof APIError) throw error
    // Invitation delivery should remain available during a Redis outage; the
    // route-level client limit still provides a second abuse control.
    console.error('Workspace invitation rate limit check failed; allowing request.', error)
  }
}

function recordAuthEvent(
  event: Parameters<ReturnType<typeof serviceBackend>['recordAuthEvent']>[0]
) {
  return serviceBackend().recordAuthEvent(event)
}

function parseWorkspaceInput<T>(result: { data?: T; success: boolean }): T {
  if (!result.success || result.data === undefined) {
    throw APIError.fromStatus('BAD_REQUEST', { message: 'Invalid workspace details.' })
  }
  return result.data
}

export const organizationHooks = {
  afterAcceptInvitation: async ({ invitation, member, user }: InvitationAcceptedHook) => {
    await recordAuthEvent({
      action: 'product.member_invitation_accepted',
      actorDisplay: user.email,
      actorUserId: user.id,
      entityId: member.id,
      entityType: 'member',
      organizationId: invitation.organizationId,
      requestId: invitation.id,
    })
  },
  afterCancelInvitation: async ({ cancelledBy, invitation }: InvitationCancelledHook) => {
    await recordAuthEvent({
      action: 'product.member_invitation_revoked',
      actorDisplay: cancelledBy.email,
      actorUserId: cancelledBy.id,
      entityId: invitation.id,
      entityType: 'invitation',
      organizationId: invitation.organizationId,
      requestId: invitation.id,
    })
  },
  afterCreateInvitation: async ({ invitation, inviter }: InvitationCreatedHook) => {
    await recordAuthEvent({
      action: 'product.member_invited',
      actorDisplay: inviter.email,
      actorUserId: inviter.id,
      entityId: invitation.id,
      entityType: 'invitation',
      metadata: { role: invitation.role },
      organizationId: invitation.organizationId,
      requestId: invitation.id,
    })
  },
  afterRejectInvitation: async ({ invitation, user }: InvitationRejectedHook) => {
    await recordAuthEvent({
      action: 'product.member_invitation_rejected',
      actorDisplay: user.email,
      actorUserId: user.id,
      entityId: invitation.id,
      entityType: 'invitation',
      organizationId: invitation.organizationId,
      requestId: invitation.id,
    })
  },
  afterRemoveMember: async ({ member }: RemovedMemberHook) => {
    // The backend also ends the removed member's sessions in this workspace.
    await recordAuthEvent({
      action: 'product.member_removed',
      entityId: member.id,
      entityType: 'member',
      organizationId: member.organizationId,
      removedUserId: member.userId,
      requestId: member.id,
    })
  },
  afterUpdateMemberRole: async ({ member }: RoleUpdatedHook) => {
    await recordAuthEvent({
      action: 'product.member_role_changed',
      entityId: member.id,
      entityType: 'member',
      metadata: { role: member.role },
      organizationId: member.organizationId,
      requestId: member.id,
    })
  },
  afterUpdateOrganization: async ({ member, organization, user }: OrganizationUpdatedHook) => {
    if (!organization) return
    await recordAuthEvent({
      action: 'product.workspace_updated',
      actorDisplay: user.email,
      actorUserId: user.id,
      entityId: organization.id,
      entityType: 'organization',
      organizationId: member.organizationId,
      requestId: organization.id,
    })
  },
  beforeAddMember: async ({ member }: MemberHook) => {
    await requireOperationalWorkspace(member.organizationId)
    if (!isSupportedOrganizationRole(member.role)) {
      throw new Error('Unsupported organization role.')
    }
    await requireSeat(member.organizationId, false)
  },
  beforeAcceptInvitation: async ({ invitation }: InvitationAcceptanceHook) => {
    await requireOperationalWorkspace(invitation.organizationId)
    await requireSeat(invitation.organizationId, false)
  },
  beforeCreateInvitation: async ({ invitation, inviter }: InvitationHook) => {
    await requireOperationalWorkspace(invitation.organizationId)
    await enforceInvitationRateLimit(invitation.organizationId, inviter.id)
    if (!isSupportedOrganizationRole(invitation.role)) {
      throw new Error('Unsupported organization role.')
    }
    if (invitation.role === 'owner') {
      throw new Error('Use workspace ownership transfer instead.')
    }
    await requireSeat(invitation.organizationId, true)
    await serviceBackend().authStore({
      data: { status: 'expired' },
      model: 'invitation',
      op: 'updateMany',
      where: [
        { field: 'email', value: invitation.email.toLowerCase() },
        { field: 'expiresAt', operator: 'lte', value: new Date().toISOString() },
        { field: 'organizationId', value: invitation.organizationId },
        { field: 'status', value: 'pending' },
      ],
    })
  },
  beforeRemoveMember: async ({ member }: RemovedMemberHook) => {
    await requireOperationalWorkspace(member.organizationId)
    if (member.role === 'owner') {
      throw new Error('Transfer workspace ownership before removing an owner.')
    }
  },
  beforeUpdateMemberRole: async ({ member, newRole }: RoleUpdateHook) => {
    await requireOperationalWorkspace(member.organizationId)
    if (!isSupportedOrganizationRole(newRole)) {
      throw new Error('Unsupported organization role.')
    }
    if (member.role === 'owner' || newRole === 'owner') {
      throw new Error('Use workspace ownership transfer instead.')
    }
  },
  beforeUpdateOrganization: async ({ member, organization }: OrganizationUpdateHook) => {
    await requireOperationalWorkspace(member.organizationId)
    return {
      data: {
        ...organization,
        ...parseWorkspaceInput(workspaceOrganizationPatchSchema.safeParse(organization)),
      },
    }
  },
}

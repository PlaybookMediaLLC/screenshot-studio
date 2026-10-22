import { APIError } from 'better-auth'
import { BackendSDKError } from 'screenshot-studio-backend-sdk'
import { serviceBackend } from '@/lib/backend/sdk'
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

// SCIM and enterprise provisioning still use these hooks. Interactive membership
// endpoints instead use workspaceMembershipEndpoints and atomic Go commands.
export const organizationHooks = {
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

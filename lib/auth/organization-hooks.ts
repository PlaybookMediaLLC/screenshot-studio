import { APIError } from 'better-auth'
import { appendAuditLog } from '@/lib/audit/log'
import { WORKSPACE_INVITATION_RATE_LIMIT } from '@/lib/api/rate-limit-policy'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { workspaceCreateSchema, workspaceOrganizationPatchSchema } from '@/lib/workspace/schemas'
import { getAuditActor } from './principal'
import { isSupportedOrganizationRole } from './permissions'

type OrganizationHook = { organization: { id: string } }
type MemberHook = OrganizationHook & { member: { organizationId: string; role: string } }
type OrganizationCreateHook = { organization: { name?: string; slug?: string } }
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
type OrganizationCreatedHook = {
  member: { id: string }
  organization: { id: string }
  user: { email: string; id: string }
}
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
  const deletion = await prisma.workspaceDeletion.findUnique({
    select: { status: true },
    where: { organizationId },
  })
  if (deletion && deletion.status !== 'CANCELLED') {
    throw APIError.fromStatus('FORBIDDEN', { message: 'This workspace is unavailable.' })
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

function parseWorkspaceInput<T>(result: { data?: T; success: boolean }): T {
  if (!result.success || result.data === undefined) {
    throw APIError.fromStatus('BAD_REQUEST', { message: 'Invalid workspace details.' })
  }
  return result.data
}

export const organizationHooks = {
  beforeCreateOrganization: async ({ organization }: OrganizationCreateHook) => ({
    data: {
      ...organization,
      ...parseWorkspaceInput(workspaceCreateSchema.safeParse(organization)),
    },
  }),
  afterCreateOrganization: async ({ member, organization, user }: OrganizationCreatedHook) => {
    await prisma.$transaction(async (transaction) => {
      await transaction.workspaceSettings.upsert({
        create: { organizationId: organization.id },
        update: {},
        where: { organizationId: organization.id },
      })
      await appendAuditLog(transaction, {
        action: 'product.workspace_created',
        actor: getAuditActor({
          display: user.email,
          kind: 'session',
          sessionId: '',
          userId: user.id,
        }),
        entityId: organization.id,
        entityType: 'organization',
        organizationId: organization.id,
        requestId: member.id,
      })
    })
  },
  afterAcceptInvitation: async ({ invitation, member, user }: InvitationAcceptedHook) => {
    await prisma.$transaction(async (transaction) => {
      await appendAuditLog(transaction, {
        action: 'product.member_invitation_accepted',
        actor: getAuditActor({
          display: user.email,
          kind: 'session',
          sessionId: '',
          userId: user.id,
        }),
        entityId: member.id,
        entityType: 'member',
        organizationId: invitation.organizationId,
        requestId: invitation.id,
      })
    })
  },
  afterCancelInvitation: async ({ cancelledBy, invitation }: InvitationCancelledHook) => {
    await prisma.$transaction(async (transaction) => {
      await appendAuditLog(transaction, {
        action: 'product.member_invitation_revoked',
        actor: getAuditActor({
          display: cancelledBy.email,
          kind: 'session',
          sessionId: '',
          userId: cancelledBy.id,
        }),
        entityId: invitation.id,
        entityType: 'invitation',
        organizationId: invitation.organizationId,
        requestId: invitation.id,
      })
    })
  },
  afterCreateInvitation: async ({ invitation, inviter }: InvitationCreatedHook) => {
    await prisma.$transaction(async (transaction) => {
      await appendAuditLog(transaction, {
        action: 'product.member_invited',
        actor: getAuditActor({
          display: inviter.email,
          kind: 'session',
          sessionId: '',
          userId: inviter.id,
        }),
        entityId: invitation.id,
        entityType: 'invitation',
        metadata: { role: invitation.role },
        organizationId: invitation.organizationId,
        requestId: invitation.id,
      })
    })
  },
  afterRejectInvitation: async ({ invitation, user }: InvitationRejectedHook) => {
    await prisma.$transaction(async (transaction) => {
      await appendAuditLog(transaction, {
        action: 'product.member_invitation_rejected',
        actor: getAuditActor({
          display: user.email,
          kind: 'session',
          sessionId: '',
          userId: user.id,
        }),
        entityId: invitation.id,
        entityType: 'invitation',
        organizationId: invitation.organizationId,
        requestId: invitation.id,
      })
    })
  },
  afterRemoveMember: async ({ member }: RemovedMemberHook) => {
    await prisma.$transaction(async (transaction) => {
      await transaction.session.deleteMany({
        where: { activeOrganizationId: member.organizationId, userId: member.userId },
      })
      await appendAuditLog(transaction, {
        action: 'product.member_removed',
        actor: { type: 'SERVICE' },
        entityId: member.id,
        entityType: 'member',
        organizationId: member.organizationId,
        requestId: member.id,
      })
    })
  },
  afterUpdateMemberRole: async ({ member }: RoleUpdatedHook) => {
    await prisma.$transaction((transaction) =>
      appendAuditLog(transaction, {
        action: 'product.member_role_changed',
        actor: { type: 'SERVICE' },
        entityId: member.id,
        entityType: 'member',
        metadata: { role: member.role },
        organizationId: member.organizationId,
        requestId: member.id,
      })
    )
  },
  afterUpdateOrganization: async ({ member, organization, user }: OrganizationUpdatedHook) => {
    if (!organization) return
    await prisma.$transaction((transaction) =>
      appendAuditLog(transaction, {
        action: 'product.workspace_updated',
        actor: getAuditActor({
          display: user.email,
          kind: 'session',
          sessionId: '',
          userId: user.id,
        }),
        entityId: organization.id,
        entityType: 'organization',
        organizationId: member.organizationId,
        requestId: organization.id,
      })
    )
  },
  beforeAddMember: async ({ member }: MemberHook) => {
    await requireOperationalWorkspace(member.organizationId)
    if (!isSupportedOrganizationRole(member.role)) {
      throw new Error('Unsupported organization role.')
    }
  },
  beforeAcceptInvitation: async ({ invitation }: InvitationAcceptanceHook) => {
    await requireOperationalWorkspace(invitation.organizationId)
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
    await prisma.invitation.updateMany({
      data: { status: 'expired' },
      where: {
        email: invitation.email.toLowerCase(),
        expiresAt: { lte: new Date() },
        organizationId: invitation.organizationId,
        status: 'pending',
      },
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

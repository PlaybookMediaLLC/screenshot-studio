import 'server-only'

import { randomUUID } from 'node:crypto'
import { Prisma, WorkspaceDeletionStatus } from '@prisma/client'
import { appendAuditLog } from '@/lib/audit/log'
import type { OrganizationAccess, SessionAccess } from '@/lib/auth/access'
import { getAuthBaseUrl } from '@/lib/auth/environment'
import { hasPermission, normalizeOrganizationRole, type Permission } from '@/lib/auth/permissions'
import { getAuditActor } from '@/lib/auth/principal'
import {
  WORKSPACE_INVITATION_RATE_LIMIT,
  WORKSPACE_INVITATION_RESEND_RATE_LIMIT,
} from '@/lib/api/rate-limit-policy'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendInvitationEmail } from '@/lib/auth/transactional-email'
import type { WorkspaceCreateInput, WorkspaceInviteInput, WorkspaceUpdateInput } from './schemas'
import { WorkspaceError } from './errors'

const deletionRecoveryMilliseconds = 14 * 24 * 60 * 60 * 1_000
const invitationLifetimeMilliseconds = 7 * 24 * 60 * 60 * 1_000

type WorkspaceTransaction = Prisma.TransactionClient

const memberSelect = {
  createdAt: true,
  id: true,
  role: true,
  user: { select: { email: true, id: true, image: true, name: true } },
} as const

const invitationSelect = {
  createdAt: true,
  email: true,
  expiresAt: true,
  id: true,
  role: true,
  status: true,
} as const

async function withSerializableTransaction<T>(
  operation: (transaction: WorkspaceTransaction) => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    } catch (error) {
      if (
        attempt < 2 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        continue
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new WorkspaceError('The workspace data conflicts with an existing record.', 409)
      }
      throw error
    }
  }
  throw new WorkspaceError('The workspace changed. Please retry.', 409)
}

async function enforceInvitationRateLimit(
  identifier: string,
  policy: typeof WORKSPACE_INVITATION_RATE_LIMIT
): Promise<void> {
  try {
    const result = await checkRateLimit(identifier, policy)
    if (!result.allowed) {
      throw new WorkspaceError('Too many invitation emails. Please try again later.', 429)
    }
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw error
    }
    // Match credential controls: a Redis outage must not block a legitimate
    // administrator from completing their workspace work.
    console.error('Workspace invitation rate limit check failed; allowing request.', error)
  }
}

function getAssignableRole(role: string): string {
  if (role === 'owner') {
    throw new WorkspaceError('Use ownership transfer to assign the owner role.', 400)
  }
  return role
}

async function getOrganizationOrThrow(transaction: WorkspaceTransaction, organizationId: string) {
  const organization = await transaction.organization.findUnique({ where: { id: organizationId } })
  if (!organization) {
    throw new WorkspaceError('Workspace not found.', 404)
  }
  return organization
}

async function getMemberOrThrow(
  transaction: WorkspaceTransaction,
  organizationId: string,
  memberId: string
) {
  const member = await transaction.member.findFirst({
    select: { id: true, role: true, userId: true },
    where: { id: memberId, organizationId },
  })
  if (!member) {
    throw new WorkspaceError('Member not found.', 404)
  }
  return member
}

async function getRequesterOrThrow(transaction: WorkspaceTransaction, access: OrganizationAccess) {
  const member = await transaction.member.findUnique({
    select: { id: true, role: true, userId: true },
    where: {
      organizationId_userId: {
        organizationId: access.organizationId,
        userId: access.principal.userId,
      },
    },
  })
  if (!member) {
    throw new WorkspaceError('Workspace membership not found.', 403)
  }
  return member
}

async function requireCurrentPermission(
  transaction: WorkspaceTransaction,
  access: OrganizationAccess,
  permission: Permission
) {
  const member = await getRequesterOrThrow(transaction, access)
  if (!hasPermission(member.role, permission)) {
    throw new WorkspaceError('You do not have permission for this workspace.', 403)
  }
  return member
}

function getSettingsData(input: WorkspaceUpdateInput) {
  return {
    defaultPublishTime: input.defaultPublishTime,
    description: input.description === '' ? null : input.description,
    locale: input.locale,
    timeZone: input.timeZone,
  }
}

export async function createWorkspace(access: SessionAccess, input: WorkspaceCreateInput) {
  return withSerializableTransaction(async (transaction) => {
    const existing = await transaction.organization.findUnique({ where: { slug: input.slug } })
    if (existing) {
      throw new WorkspaceError('This workspace slug is already taken.', 409)
    }

    const now = new Date()
    const organization = await transaction.organization.create({
      data: { createdAt: now, id: randomUUID(), name: input.name, slug: input.slug },
    })
    await transaction.member.create({
      data: {
        createdAt: now,
        id: randomUUID(),
        organizationId: organization.id,
        role: 'owner',
        userId: access.principal.userId,
      },
    })
    const settings = await transaction.workspaceSettings.create({
      data: { organizationId: organization.id },
    })
    await transaction.session.update({
      data: { activeOrganizationId: organization.id },
      where: { id: access.principal.sessionId },
    })
    await appendAuditLog(transaction, {
      action: 'product.workspace_created',
      actor: getAuditActor(access.principal),
      entityId: organization.id,
      entityType: 'organization',
      organizationId: organization.id,
      requestId: access.requestId,
    })
    return { organization, settings }
  })
}

export async function listWorkspaces(access: SessionAccess) {
  const memberships = await prisma.member.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          workspaceDeletion: { select: { requestedByUserId: true, status: true } },
        },
      },
      role: true,
    },
    where: { userId: access.principal.userId },
  })
  return memberships
    .filter(({ organization }) => {
      const deletion = organization.workspaceDeletion
      return (
        !deletion ||
        deletion.status === 'CANCELLED' ||
        (deletion.status === 'PENDING' && deletion.requestedByUserId === access.principal.userId)
      )
    })
    .map(({ organization, role }) => ({
      id: organization.id,
      isScheduledForDeletion: organization.workspaceDeletion?.status === 'PENDING',
      name: organization.name,
      role,
      slug: organization.slug,
    }))
}

export async function setActiveWorkspace(access: SessionAccess, organizationId: string) {
  const membership = await prisma.member.findUnique({
    select: {
      organization: {
        select: { workspaceDeletion: { select: { requestedByUserId: true, status: true } } },
      },
    },
    where: { organizationId_userId: { organizationId, userId: access.principal.userId } },
  })
  if (!membership) {
    throw new WorkspaceError('Workspace not found.', 404)
  }
  const deletion = membership.organization.workspaceDeletion
  if (
    deletion?.status === 'PROCESSING' ||
    (deletion?.status === 'PENDING' && deletion.requestedByUserId !== access.principal.userId)
  ) {
    throw new WorkspaceError('This workspace is scheduled for deletion.', 403)
  }
  await prisma.session.update({
    data: { activeOrganizationId: organizationId },
    where: { id: access.principal.sessionId },
  })
}

export async function getWorkspace(organizationId: string) {
  return prisma.organization.findUnique({
    select: {
      id: true,
      logo: true,
      name: true,
      slug: true,
      workspaceSettings: true,
    },
    where: { id: organizationId },
  })
}

export async function updateWorkspace(access: OrganizationAccess, input: WorkspaceUpdateInput) {
  return withSerializableTransaction(async (transaction) => {
    await requireCurrentPermission(transaction, access, 'workspace:update')
    await getOrganizationOrThrow(transaction, access.organizationId)
    const slugOwner = await transaction.organization.findUnique({
      select: { id: true },
      where: { slug: input.slug },
    })
    if (slugOwner && slugOwner.id !== access.organizationId) {
      throw new WorkspaceError('This workspace slug is already taken.', 409)
    }
    const organization = await transaction.organization.update({
      data: { logo: input.logo, name: input.name, slug: input.slug },
      select: { id: true, logo: true, name: true, slug: true },
      where: { id: access.organizationId },
    })
    const settings = await transaction.workspaceSettings.upsert({
      create: { organizationId: access.organizationId, ...getSettingsData(input) },
      update: getSettingsData(input),
      where: { organizationId: access.organizationId },
    })
    await appendAuditLog(transaction, {
      action: 'product.workspace_updated',
      actor: getAuditActor(access.principal),
      entityId: organization.id,
      entityType: 'organization',
      organizationId: access.organizationId,
      requestId: access.requestId,
    })
    return { organization, settings }
  })
}

export async function listWorkspaceMembers(organizationId: string) {
  const members = await prisma.member.findMany({
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: memberSelect,
    where: { organizationId },
  })
  return members.map((member) => ({ ...member, role: normalizeOrganizationRole(member.role) }))
}

export async function listWorkspaceInvitations(organizationId: string) {
  const now = new Date()
  await prisma.invitation.updateMany({
    data: { status: 'expired' },
    where: {
      expiresAt: { lte: now },
      organizationId,
      status: 'pending',
    },
  })
  const invitations = await prisma.invitation.findMany({
    orderBy: { createdAt: 'desc' },
    select: invitationSelect,
    where: { organizationId, status: 'pending' },
  })
  return invitations.map((invitation) => ({
    ...invitation,
    role: invitation.role ? normalizeOrganizationRole(invitation.role) : null,
  }))
}

async function sendWorkspaceInvitation(input: {
  email: string
  invitationId: string
  inviterName: string
  organizationName: string
}) {
  const acceptUrl = new URL('/accept-invitation', getAuthBaseUrl())
  acceptUrl.searchParams.set('invitationId', input.invitationId)
  try {
    await sendInvitationEmail({
      acceptUrl: acceptUrl.toString(),
      inviterName: input.inviterName,
      organizationName: input.organizationName,
      to: input.email,
    })
  } catch (error) {
    console.error('Workspace invitation email delivery failed.', {
      invitationId: input.invitationId,
      reason: error instanceof Error ? error.message : 'unknown',
    })
  }
}

export async function inviteWorkspaceMember(
  access: OrganizationAccess,
  input: WorkspaceInviteInput
) {
  await enforceInvitationRateLimit(
    `${access.organizationId}:${access.principal.userId}`,
    WORKSPACE_INVITATION_RATE_LIMIT
  )
  const invitation = await withSerializableTransaction(async (transaction) => {
    const requester = await requireCurrentPermission(transaction, access, 'member:invite')
    const existingMember = await transaction.member.findFirst({
      select: { id: true },
      where: { organizationId: access.organizationId, user: { is: { email: input.email } } },
    })
    if (existingMember) {
      throw new WorkspaceError('This user is already a workspace member.', 409)
    }
    await transaction.invitation.updateMany({
      data: { status: 'expired' },
      where: {
        email: input.email,
        expiresAt: { lte: new Date() },
        organizationId: access.organizationId,
        status: 'pending',
      },
    })
    const existingInvitation = await transaction.invitation.findFirst({
      select: { id: true },
      where: { email: input.email, organizationId: access.organizationId, status: 'pending' },
    })
    if (existingInvitation) {
      throw new WorkspaceError('This email already has a pending invitation.', 409)
    }
    const created = await transaction.invitation.create({
      data: {
        email: input.email,
        expiresAt: new Date(Date.now() + invitationLifetimeMilliseconds),
        id: randomUUID(),
        inviterId: requester.userId,
        organizationId: access.organizationId,
        role: getAssignableRole(input.role),
        status: 'pending',
      },
      select: {
        ...invitationSelect,
        organization: { select: { name: true } },
        user: { select: { email: true, name: true } },
      },
    })
    await appendAuditLog(transaction, {
      action: 'product.member_invited',
      actor: getAuditActor(access.principal),
      entityId: created.id,
      entityType: 'invitation',
      metadata: { role: created.role },
      organizationId: access.organizationId,
      requestId: access.requestId,
    })
    return created
  })
  await sendWorkspaceInvitation({
    email: invitation.email,
    invitationId: invitation.id,
    inviterName: invitation.user.name || invitation.user.email,
    organizationName: invitation.organization.name,
  })
  return invitation
}

export async function resendWorkspaceInvitation(access: OrganizationAccess, invitationId: string) {
  await enforceInvitationRateLimit(
    `${access.organizationId}:${access.principal.userId}:${invitationId}`,
    WORKSPACE_INVITATION_RESEND_RATE_LIMIT
  )
  const invitation = await withSerializableTransaction(async (transaction) => {
    await requireCurrentPermission(transaction, access, 'member:invite')
    const extended = await transaction.invitation.updateMany({
      data: { expiresAt: new Date(Date.now() + invitationLifetimeMilliseconds) },
      where: {
        expiresAt: { gt: new Date() },
        id: invitationId,
        organizationId: access.organizationId,
        status: 'pending',
      },
    })
    if (extended.count === 0) {
      throw new WorkspaceError('Pending invitation not found.', 404)
    }
    const updated = await transaction.invitation.findFirst({
      select: {
        ...invitationSelect,
        organization: { select: { name: true } },
        user: { select: { email: true, name: true } },
      },
      where: { id: invitationId, organizationId: access.organizationId, status: 'pending' },
    })
    if (!updated) throw new WorkspaceError('Pending invitation not found.', 404)
    await appendAuditLog(transaction, {
      action: 'product.member_invitation_resent',
      actor: getAuditActor(access.principal),
      entityId: updated.id,
      entityType: 'invitation',
      organizationId: access.organizationId,
      requestId: access.requestId,
    })
    return updated
  })
  await sendWorkspaceInvitation({
    email: invitation.email,
    invitationId: invitation.id,
    inviterName: invitation.user.name || invitation.user.email,
    organizationName: invitation.organization.name,
  })
  return invitation
}

export async function revokeWorkspaceInvitation(access: OrganizationAccess, invitationId: string) {
  return withSerializableTransaction(async (transaction) => {
    await requireCurrentPermission(transaction, access, 'invitation:revoke')
    const revoked = await transaction.invitation.updateMany({
      data: { status: 'canceled' },
      where: { id: invitationId, organizationId: access.organizationId, status: 'pending' },
    })
    if (revoked.count === 0) {
      throw new WorkspaceError('Pending invitation not found.', 404)
    }
    await appendAuditLog(transaction, {
      action: 'product.member_invitation_revoked',
      actor: getAuditActor(access.principal),
      entityId: invitationId,
      entityType: 'invitation',
      organizationId: access.organizationId,
      requestId: access.requestId,
    })
    return { id: invitationId, status: 'canceled' }
  })
}

export async function updateWorkspaceMemberRole(
  access: OrganizationAccess,
  memberId: string,
  role: string
) {
  return withSerializableTransaction(async (transaction) => {
    await requireCurrentPermission(transaction, access, 'member:update_role')
    const member = await getMemberOrThrow(transaction, access.organizationId, memberId)
    if (member.role === 'owner') {
      throw new WorkspaceError('Use ownership transfer to change an owner role.', 409)
    }
    const changed = await transaction.member.updateMany({
      data: { role: getAssignableRole(role) },
      where: { id: member.id, organizationId: access.organizationId, role: { not: 'owner' } },
    })
    if (changed.count === 0) {
      throw new WorkspaceError('Member role changed. Please retry.', 409)
    }
    const updated = await transaction.member.findFirstOrThrow({
      select: memberSelect,
      where: { id: member.id, organizationId: access.organizationId },
    })
    await appendAuditLog(transaction, {
      action: 'product.member_role_changed',
      actor: getAuditActor(access.principal),
      entityId: member.id,
      entityType: 'member',
      metadata: { role: updated.role },
      organizationId: access.organizationId,
      requestId: access.requestId,
    })
    return updated
  })
}

export async function removeWorkspaceMember(access: OrganizationAccess, memberId: string) {
  return withSerializableTransaction(async (transaction) => {
    await requireCurrentPermission(transaction, access, 'member:remove')
    const member = await getMemberOrThrow(transaction, access.organizationId, memberId)
    if (member.role === 'owner') {
      throw new WorkspaceError('Transfer ownership before removing an owner.', 409)
    }
    if (member.userId === access.principal.userId) {
      throw new WorkspaceError('Use leave workspace to remove yourself.', 400)
    }
    const removed = await transaction.member.deleteMany({
      where: { id: member.id, organizationId: access.organizationId, role: { not: 'owner' } },
    })
    if (removed.count === 0) {
      throw new WorkspaceError('Member role changed. Please retry.', 409)
    }
    await transaction.session.deleteMany({
      where: { activeOrganizationId: access.organizationId, userId: member.userId },
    })
    await appendAuditLog(transaction, {
      action: 'product.member_removed',
      actor: getAuditActor(access.principal),
      entityId: member.id,
      entityType: 'member',
      organizationId: access.organizationId,
      requestId: access.requestId,
    })
  })
}

export async function leaveWorkspace(access: OrganizationAccess) {
  return withSerializableTransaction(async (transaction) => {
    const member = await getRequesterOrThrow(transaction, access)
    if (member.role === 'owner') {
      throw new WorkspaceError('Transfer ownership before leaving this workspace.', 409)
    }
    const removed = await transaction.member.deleteMany({
      where: { id: member.id, organizationId: access.organizationId, role: { not: 'owner' } },
    })
    if (removed.count === 0) {
      throw new WorkspaceError('Member role changed. Please retry.', 409)
    }
    await transaction.session.deleteMany({
      where: { activeOrganizationId: access.organizationId, userId: member.userId },
    })
    await appendAuditLog(transaction, {
      action: 'product.member_left',
      actor: getAuditActor(access.principal),
      entityId: member.id,
      entityType: 'member',
      organizationId: access.organizationId,
      requestId: access.requestId,
    })
  })
}

export async function transferWorkspaceOwnership(access: OrganizationAccess, memberId: string) {
  return withSerializableTransaction(async (transaction) => {
    const requester = await getRequesterOrThrow(transaction, access)
    if (requester.role !== 'owner') {
      throw new WorkspaceError('Only the workspace owner can transfer ownership.', 403)
    }
    const recipient = await getMemberOrThrow(transaction, access.organizationId, memberId)
    if (recipient.id === requester.id) {
      throw new WorkspaceError('Choose another workspace member.', 400)
    }
    if (recipient.role === 'owner') {
      throw new WorkspaceError('This member is already an owner.', 409)
    }
    const demoted = await transaction.member.updateMany({
      data: { role: 'admin' },
      where: { id: requester.id, organizationId: access.organizationId, role: 'owner' },
    })
    if (demoted.count === 0) {
      throw new WorkspaceError('Only the workspace owner can transfer ownership.', 403)
    }
    const promoted = await transaction.member.updateMany({
      data: { role: 'owner' },
      where: { id: recipient.id, organizationId: access.organizationId, role: { not: 'owner' } },
    })
    if (promoted.count === 0) {
      throw new WorkspaceError('Member role changed. Please retry.', 409)
    }
    await appendAuditLog(transaction, {
      action: 'product.workspace_ownership_transferred',
      actor: getAuditActor(access.principal),
      entityId: recipient.id,
      entityType: 'member',
      organizationId: access.organizationId,
      requestId: access.requestId,
    })
  })
}

export async function requestWorkspaceDeletion(access: OrganizationAccess, confirmation: string) {
  return withSerializableTransaction(async (transaction) => {
    const requester = await getRequesterOrThrow(transaction, access)
    if (requester.role !== 'owner') {
      throw new WorkspaceError('Only the workspace owner can delete this workspace.', 403)
    }
    const organization = await getOrganizationOrThrow(transaction, access.organizationId)
    if (organization.name !== confirmation) {
      throw new WorkspaceError('Enter the exact workspace name to continue.', 400)
    }
    const scheduledFor = new Date(Date.now() + deletionRecoveryMilliseconds)
    const deletion = await transaction.workspaceDeletion.upsert({
      create: {
        organizationId: access.organizationId,
        requestedByUserId: access.principal.userId,
        scheduledFor,
        status: WorkspaceDeletionStatus.PENDING,
      },
      update: {
        cancelledAt: null,
        lastError: null,
        processingAt: null,
        requestedByUserId: access.principal.userId,
        scheduledFor,
        status: WorkspaceDeletionStatus.PENDING,
      },
      where: { organizationId: access.organizationId },
    })
    await appendAuditLog(transaction, {
      action: 'product.workspace_deletion_scheduled',
      actor: getAuditActor(access.principal),
      entityId: deletion.id,
      entityType: 'workspace_deletion',
      organizationId: access.organizationId,
      requestId: access.requestId,
    })
    return deletion
  })
}

export async function cancelWorkspaceDeletion(access: SessionAccess) {
  return withSerializableTransaction(async (transaction) => {
    const session = await transaction.session.findUnique({
      select: { activeOrganizationId: true },
      where: { id: access.principal.sessionId },
    })
    if (!session?.activeOrganizationId) {
      throw new WorkspaceError('No active workspace is available to restore.', 404)
    }
    const deletion = await transaction.workspaceDeletion.findUnique({
      where: {
        organizationId: session.activeOrganizationId,
      },
    })
    if (
      !deletion ||
      deletion.requestedByUserId !== access.principal.userId ||
      deletion.status !== WorkspaceDeletionStatus.PENDING
    ) {
      throw new WorkspaceError('No scheduled workspace deletion was found.', 404)
    }
    const restored = await transaction.workspaceDeletion.update({
      data: { cancelledAt: new Date(), status: WorkspaceDeletionStatus.CANCELLED },
      where: { id: deletion.id },
    })
    await appendAuditLog(transaction, {
      action: 'product.workspace_deletion_cancelled',
      actor: getAuditActor(access.principal),
      entityId: restored.id,
      entityType: 'workspace_deletion',
      organizationId: restored.organizationId,
      requestId: access.requestId,
    })
    return restored
  })
}

async function removeWorkspaceData(transaction: WorkspaceTransaction, organizationId: string) {
  await transaction.auditDrain.deleteMany({ where: { organizationId } })
  await transaction.auditRetentionPolicy.deleteMany({ where: { organizationId } })
  await transaction.communicationRecipient.deleteMany({ where: { organizationId } })
  await transaction.communicationAttempt.deleteMany({ where: { organizationId } })
  await transaction.customerCommunication.deleteMany({ where: { organizationId } })
  await transaction.campaignPost.deleteMany({ where: { organizationId } })
  await transaction.contentAngle.deleteMany({ where: { organizationId } })
  await transaction.campaign.deleteMany({ where: { organizationId } })
  await transaction.publicationAttempt.deleteMany({ where: { organizationId } })
  await transaction.scheduledPost.deleteMany({ where: { organizationId } })
  await transaction.channelConnection.deleteMany({ where: { organizationId } })
  await transaction.approval.deleteMany({ where: { organizationId } })
  await transaction.creativeVariant.deleteMany({ where: { organizationId } })
  await transaction.releaseDocument.deleteMany({ where: { organizationId } })
  await transaction.captureJob.deleteMany({ where: { organizationId } })
  await transaction.capture.deleteMany({ where: { organizationId } })
  await transaction.asset.deleteMany({ where: { organizationId } })
  await transaction.creativeTemplate.deleteMany({ where: { organizationId } })
  await transaction.captureRecipe.deleteMany({ where: { organizationId } })
  await transaction.sourceApp.deleteMany({ where: { organizationId } })
  await transaction.brandKit.deleteMany({ where: { organizationId } })
  await transaction.brandProfile.deleteMany({ where: { organizationId } })
  await transaction.productSurface.deleteMany({ where: { organizationId } })
  await transaction.release.deleteMany({ where: { organizationId } })
  await transaction.audienceSubscriber.deleteMany({ where: { organizationId } })
  await transaction.supportAccessGrant.deleteMany({ where: { organizationId } })
  await transaction.outboxEvent.deleteMany({ where: { organizationId } })
  await transaction.apikey.deleteMany({ where: { referenceId: organizationId } })
  await transaction.ssoProvider.deleteMany({ where: { organizationId } })
  await transaction.scimProvider.deleteMany({ where: { organizationId } })
  await transaction.organizationEnterpriseSettings.deleteMany({ where: { organizationId } })
  await transaction.workspaceSettings.deleteMany({ where: { organizationId } })
  await transaction.invitation.deleteMany({ where: { organizationId } })
  await transaction.session.deleteMany({ where: { activeOrganizationId: organizationId } })
  await transaction.member.deleteMany({ where: { organizationId } })
}

async function claimWorkspaceDeletion(deletionId: string): Promise<boolean> {
  const claimed = await prisma.workspaceDeletion.updateMany({
    data: { lastError: null, processingAt: new Date(), status: WorkspaceDeletionStatus.PROCESSING },
    where: {
      id: deletionId,
      scheduledFor: { lte: new Date() },
      status: WorkspaceDeletionStatus.PENDING,
    },
  })
  return claimed.count === 1
}

export async function purgeDueWorkspaceDeletions(): Promise<number> {
  const dueDeletions = await prisma.workspaceDeletion.findMany({
    orderBy: { scheduledFor: 'asc' },
    select: { id: true, organizationId: true },
    take: 10,
    where: { scheduledFor: { lte: new Date() }, status: WorkspaceDeletionStatus.PENDING },
  })

  let purgedCount = 0
  for (const deletion of dueDeletions) {
    if (!(await claimWorkspaceDeletion(deletion.id))) {
      continue
    }
    try {
      const assets = await prisma.asset.findMany({
        select: { objectKey: true },
        where: { organizationId: deletion.organizationId },
      })
      const { deleteTenantObject } = await import('@/lib/storage/client')
      for (const asset of assets) {
        await deleteTenantObject({
          objectKey: asset.objectKey,
          organizationId: deletion.organizationId,
        })
      }
      await prisma.$transaction(async (transaction) => {
        await removeWorkspaceData(transaction, deletion.organizationId)
        await transaction.organization.update({
          data: {
            logo: null,
            metadata: null,
            name: `Deleted workspace ${deletion.organizationId.slice(0, 8)}`,
            slug: `deleted-${deletion.organizationId.toLowerCase()}`,
          },
          where: { id: deletion.organizationId },
        })
        const purged = await transaction.workspaceDeletion.update({
          data: {
            processingAt: null,
            purgedAt: new Date(),
            status: WorkspaceDeletionStatus.PURGED,
          },
          where: { id: deletion.id },
        })
        await appendAuditLog(transaction, {
          action: 'product.workspace_purged',
          actor: { type: 'SERVICE' },
          entityId: purged.id,
          entityType: 'workspace_deletion',
          organizationId: deletion.organizationId,
          requestId: deletion.id,
        })
      })
      purgedCount += 1
    } catch (error) {
      await prisma.workspaceDeletion.update({
        data: {
          lastError:
            error instanceof Error ? error.message.slice(0, 500) : 'Workspace purge failed.',
          processingAt: null,
          status: WorkspaceDeletionStatus.PENDING,
        },
        where: { id: deletion.id },
      })
    }
  }
  return purgedCount
}

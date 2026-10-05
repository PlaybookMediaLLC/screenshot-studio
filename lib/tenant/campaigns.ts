import 'server-only'

import { randomUUID } from 'node:crypto'
import type { CampaignStatus, Prisma } from '@prisma/client'
import { appendAuditLog } from '@/lib/audit/log'
import type { OrganizationAccess, TenantContext } from '@/lib/auth/access'
import { hasPermission } from '@/lib/auth/permissions'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import { getNextWorkspacePublishTime } from '@/lib/workspace/schedule'
import {
  type CampaignApprovalDecision,
  campaignPostTransitions,
  getCampaignTransitionPermission,
} from './campaign-status'
import { requireWorkspaceProductSurface } from './releases'
import { createScheduledPost } from './scheduled-posts'
import type { CampaignCreateInput, CampaignPostScheduleInput } from './schemas'

const SCHEDULED_POST_CAPTION_LIMIT = 3_000

const campaignInclude = {
  angles: { orderBy: { position: 'asc' as const } },
  posts: { orderBy: { createdAt: 'asc' as const } },
  productSurface: { select: { environment: true, id: true, name: true, url: true } },
  release: {
    select: {
      audience: true,
      benefitStatement: true,
      description: true,
      id: true,
      sourceUrls: true,
      status: true,
      title: true,
      updatedAt: true,
    },
  },
}

export class CampaignError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409
  ) {
    super(message)
    this.name = 'CampaignError'
  }
}

export async function listCampaigns(organizationId: string) {
  return prisma.campaign.findMany({
    include: { release: { select: { id: true, title: true } } },
    orderBy: { createdAt: 'desc' },
    where: { organizationId },
  })
}

export async function getCampaign(organizationId: string, campaignId: string) {
  return prisma.campaign.findFirst({
    include: campaignInclude,
    where: { id: campaignId, organizationId },
  })
}

/**
 * Resolve the release and surface a new campaign links to, rejecting ids from
 * another workspace. A campaign created from a release inherits the release's
 * surface unless the caller names one.
 */
async function resolveCampaignContext(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  input: Pick<CampaignCreateInput, 'productSurfaceId' | 'releaseId'>
): Promise<{ productSurfaceId: string | null; releaseId: string | null }> {
  await requireWorkspaceProductSurface(transaction, organizationId, input.productSurfaceId)
  if (!input.releaseId) {
    return { productSurfaceId: input.productSurfaceId ?? null, releaseId: null }
  }
  const release = await transaction.release.findFirst({
    select: { id: true, productSurfaceId: true },
    where: { id: input.releaseId, organizationId },
  })
  if (!release) {
    throw new CampaignError('Release not found.', 404)
  }
  return {
    productSurfaceId: input.productSurfaceId ?? release.productSurfaceId,
    releaseId: release.id,
  }
}

export async function createCampaign(context: TenantContext, input: CampaignCreateInput) {
  for (const post of input.posts) {
    if (post.angleIndex !== undefined && post.angleIndex >= input.angles.length) {
      throw new CampaignError('A post references an angle that does not exist.', 400)
    }
  }
  return prisma.$transaction(async (transaction) => {
    const links = await resolveCampaignContext(transaction, context.organizationId, input)
    const organization = await transaction.organization.findUniqueOrThrow({
      select: { createdAt: true },
      where: { id: context.organizationId },
    })
    // New campaigns always start as DRAFT, and a draft may be empty: generated
    // content is only required when the campaign moves to review.
    const campaign = await transaction.campaign.create({
      data: {
        audience: input.audience ?? null,
        createdByUserId: context.principal.kind === 'session' ? context.principal.userId : null,
        feature: input.feature ?? null,
        messaging: input.messaging ?? null,
        name: input.name,
        objective: input.objective,
        organizationId: context.organizationId,
        productSurfaceId: links.productSurfaceId,
        releaseId: links.releaseId,
      },
    })
    const angleIds: string[] = []
    for (const [position, angle] of input.angles.entries()) {
      const created = await transaction.contentAngle.create({
        data: {
          campaignId: campaign.id,
          hook: angle.hook,
          organizationId: context.organizationId,
          position,
          title: angle.title,
        },
      })
      angleIds.push(created.id)
    }
    for (const post of input.posts) {
      await transaction.campaignPost.create({
        data: {
          angleId: post.angleIndex === undefined ? null : angleIds[post.angleIndex],
          callToAction: post.callToAction ?? null,
          campaignId: campaign.id,
          channel: post.channel,
          copy: post.copy,
          organizationId: context.organizationId,
        },
      })
    }
    await appendAuditLog(transaction, {
      action: 'product.campaign_created',
      actor: getAuditActor(context.principal),
      entityId: campaign.id,
      entityType: 'campaign',
      metadata: {
        angleCount: input.angles.length,
        postCount: input.posts.length,
        productSurfaceId: links.productSurfaceId,
        releaseId: links.releaseId,
        // Time-to-first-draft is the earliest of these per workspace.
        workspaceAgeSeconds: Math.round((Date.now() - organization.createdAt.getTime()) / 1_000),
      },
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return transaction.campaign.findUniqueOrThrow({
      include: campaignInclude,
      where: { id: campaign.id },
    })
  })
}

/**
 * Move a campaign through its lifecycle. The permission comes from the
 * transition table, and the current role is re-checked here because the
 * required permission depends on the stored status. The write is
 * conditional on that status, so two racing transitions cannot both apply.
 */
export async function transitionCampaign(
  access: OrganizationAccess,
  campaignId: string,
  to: CampaignStatus
) {
  return prisma.$transaction(async (transaction) => {
    const campaign = await transaction.campaign.findFirst({
      select: { _count: { select: { posts: true } }, id: true, status: true },
      where: { id: campaignId, organizationId: access.organizationId },
    })
    if (!campaign) {
      throw new CampaignError('Campaign not found.', 404)
    }
    const permission = getCampaignTransitionPermission(campaign.status, to)
    if (!permission) {
      throw new CampaignError(`A ${campaign.status} campaign cannot move to ${to}.`, 409)
    }
    if (!hasPermission(access.role, permission)) {
      throw new CampaignError('You do not have permission for this transition.', 403)
    }
    if (to === 'READY_FOR_REVIEW' && campaign._count.posts === 0) {
      throw new CampaignError('Add at least one post before submitting for review.', 409)
    }
    const updated = await transaction.campaign.updateMany({
      data: { status: to },
      where: { id: campaign.id, status: campaign.status },
    })
    if (updated.count === 0) {
      throw new CampaignError('The campaign changed. Please retry.', 409)
    }
    await appendAuditLog(transaction, {
      action: 'product.campaign_status_changed',
      actor: getAuditActor(access.principal),
      entityId: campaign.id,
      entityType: 'campaign',
      metadata: { from: campaign.status, to },
      organizationId: access.organizationId,
      requestId: access.requestId,
    })
    return { id: campaign.id, status: to }
  })
}

export async function transitionCampaignPosts(
  context: TenantContext,
  campaignId: string,
  decision: CampaignApprovalDecision,
  postIds?: readonly string[]
) {
  const transition = campaignPostTransitions[decision]
  return prisma.$transaction(async (transaction) => {
    const campaign = await transaction.campaign.findFirst({
      select: { id: true },
      where: { id: campaignId, organizationId: context.organizationId },
    })
    if (!campaign) {
      throw new CampaignError('Campaign not found.', 404)
    }
    const eligiblePosts = await transaction.campaignPost.findMany({
      select: { id: true, status: true },
      where: {
        campaignId,
        organizationId: context.organizationId,
        status: { in: [...transition.from] },
        ...(postIds && { id: { in: [...postIds] } }),
      },
    })
    if (postIds && eligiblePosts.length !== postIds.length) {
      throw new CampaignError('One or more posts cannot make this transition.', 409)
    }
    if (eligiblePosts.length === 0) {
      throw new CampaignError('No posts are eligible for this transition.', 409)
    }
    const eligibleIds = eligiblePosts.map((post) => post.id)
    await transaction.campaignPost.updateMany({
      data: { status: transition.to },
      where: { id: { in: eligibleIds } },
    })
    await appendAuditLog(transaction, {
      action: 'product.campaign_post_status_changed',
      actor: getAuditActor(context.principal),
      entityId: campaignId,
      entityType: 'campaign',
      metadata: { decision, postCount: eligibleIds.length },
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return { postIds: eligibleIds, status: transition.to }
  })
}

export async function scheduleCampaignPost(
  context: TenantContext,
  campaignId: string,
  postId: string,
  input: CampaignPostScheduleInput
) {
  const post = await prisma.campaignPost.findFirst({
    where: { campaignId, id: postId, organizationId: context.organizationId },
  })
  if (!post) {
    throw new CampaignError('Campaign post not found.', 404)
  }
  if (post.status !== 'APPROVED') {
    throw new CampaignError('Only approved posts can be scheduled.', 409)
  }
  if (!post.creativeVariantId) {
    throw new CampaignError('The post needs a linked creative variant before scheduling.', 409)
  }
  if (post.copy.length > SCHEDULED_POST_CAPTION_LIMIT) {
    throw new CampaignError('The post copy exceeds the channel caption limit.', 409)
  }
  const settings = input.scheduledAt
    ? null
    : await prisma.workspaceSettings.findUnique({
        select: { defaultPublishTime: true, timeZone: true },
        where: { organizationId: context.organizationId },
      })
  const scheduledAt =
    input.scheduledAt ??
    getNextWorkspacePublishTime({
      time: settings?.defaultPublishTime ?? '09:00',
      timeZone: settings?.timeZone ?? 'UTC',
    })
  const { scheduledPost } = await createScheduledPost(context, {
    caption: post.copy,
    channelConnectionId: input.channelConnectionId,
    idempotencyKey: randomUUID(),
    scheduledFor: scheduledAt,
    variantId: post.creativeVariantId,
  })
  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.campaignPost.update({
      data: {
        scheduledAt,
        scheduledPostId: scheduledPost.id,
        status: 'SCHEDULED',
      },
      where: { id: post.id },
    })
    await appendAuditLog(transaction, {
      action: 'product.campaign_post_scheduled',
      actor: getAuditActor(context.principal),
      entityId: post.id,
      entityType: 'campaign_post',
      metadata: { campaignId, scheduledPostId: scheduledPost.id },
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return updated
  })
}

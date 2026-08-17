import 'server-only'

import { randomUUID } from 'node:crypto'
import { appendAuditLog } from '@/lib/audit/log'
import type { TenantContext } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import { type CampaignApprovalDecision, campaignPostTransitions } from './campaign-status'
import { createScheduledPost } from './scheduled-posts'
import type { CampaignCreateInput, CampaignPostScheduleInput } from './schemas'

const SCHEDULED_POST_CAPTION_LIMIT = 3_000

const campaignInclude = {
  angles: { orderBy: { position: 'asc' as const } },
  posts: { orderBy: { createdAt: 'asc' as const } },
}

export class CampaignError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message)
  }
}

export async function listCampaigns(organizationId: string) {
  return prisma.campaign.findMany({
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

export async function createCampaign(context: TenantContext, input: CampaignCreateInput) {
  for (const post of input.posts) {
    if (post.angleIndex !== undefined && post.angleIndex >= input.angles.length) {
      throw new CampaignError('A post references an angle that does not exist.', 400)
    }
  }
  return prisma.$transaction(async (transaction) => {
    const campaign = await transaction.campaign.create({
      data: {
        audience: input.audience ?? null,
        feature: input.feature ?? null,
        messaging: input.messaging ?? null,
        name: input.name,
        objective: input.objective,
        organizationId: context.organizationId,
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
      metadata: { angleCount: input.angles.length, postCount: input.posts.length },
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return transaction.campaign.findUniqueOrThrow({
      include: campaignInclude,
      where: { id: campaign.id },
    })
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
  const { scheduledPost } = await createScheduledPost(context, {
    caption: post.copy,
    channelConnectionId: input.channelConnectionId,
    idempotencyKey: randomUUID(),
    scheduledFor: input.scheduledAt,
    variantId: post.creativeVariantId,
  })
  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.campaignPost.update({
      data: {
        scheduledAt: input.scheduledAt,
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

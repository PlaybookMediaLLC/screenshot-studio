import 'server-only'

import { appendAuditLog } from '@/lib/audit/log'
import { getAuditActor, type TriggerServicePrincipal } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import { isWorkspaceOperational } from '@/lib/workspace/access'
import { PostizProviderError, publishPostizPost } from './postiz'

const maxPublicationAttempts = 3
const staleProcessingMilliseconds = 10 * 60 * 1000

function getTriggerPrincipal(
  organizationId: string,
  scheduledPostId: string
): TriggerServicePrincipal {
  return { kind: 'trigger_service', organizationId, taskRunId: scheduledPostId }
}

async function claimScheduledPost(id: string): Promise<boolean> {
  const claimed = await prisma.scheduledPost.updateMany({
    data: { status: 'PROCESSING' },
    where: { id, scheduledFor: { lte: new Date() }, status: 'SCHEDULED' },
  })
  return claimed.count === 1
}

async function requeueStaleUnclaimedPosts(staleBefore: Date): Promise<void> {
  await prisma.scheduledPost.updateMany({
    data: { status: 'SCHEDULED' },
    where: {
      attempts: { none: { completedAt: null } },
      status: 'PROCESSING',
      updatedAt: { lt: staleBefore },
    },
  })
}

async function failUncertainStalePosts(staleBefore: Date): Promise<void> {
  const posts = await prisma.scheduledPost.findMany({
    select: { id: true, organizationId: true },
    take: 100,
    where: {
      attempts: { some: { completedAt: null } },
      status: 'PROCESSING',
      updatedAt: { lt: staleBefore },
    },
  })
  for (const post of posts) {
    await prisma.$transaction(async (transaction) => {
      const failed = await transaction.scheduledPost.updateMany({
        data: { status: 'FAILED' },
        where: { id: post.id, status: 'PROCESSING', updatedAt: { lt: staleBefore } },
      })
      if (failed.count === 0) return

      await transaction.publicationAttempt.updateMany({
        data: { completedAt: new Date(), failureCode: 'UNKNOWN_DELIVERY', outcome: 'FAILED' },
        where: { completedAt: null, scheduledPostId: post.id },
      })
      await appendAuditLog(transaction, {
        action: 'post.publish_recovery_required',
        actor: getAuditActor(getTriggerPrincipal(post.organizationId, post.id)),
        entityId: post.id,
        entityType: 'scheduled_post',
        metadata: { failureCode: 'UNKNOWN_DELIVERY' },
        organizationId: post.organizationId,
        outcome: 'FAILED',
        requestId: post.id,
      })
    })
  }
}

async function recoverStaleScheduledPosts(): Promise<void> {
  const staleBefore = new Date(Date.now() - staleProcessingMilliseconds)
  await requeueStaleUnclaimedPosts(staleBefore)
  await failUncertainStalePosts(staleBefore)
}

async function loadScheduledPost(id: string) {
  return prisma.scheduledPost.findFirst({
    include: {
      channelConnection: true,
      variant: { include: { approval: true, sourceAsset: true } },
    },
    where: { id, status: 'PROCESSING' },
  })
}

async function cancelIneligiblePost(id: string, organizationId: string): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const cancelled = await transaction.scheduledPost.updateMany({
      data: { status: 'CANCELLED' },
      where: { id, status: 'PROCESSING' },
    })
    if (cancelled.count === 0) {
      return
    }
    await appendAuditLog(transaction, {
      action: 'post.cancelled',
      actor: getAuditActor(getTriggerPrincipal(organizationId, id)),
      entityId: id,
      entityType: 'scheduled_post',
      organizationId,
      requestId: id,
    })
  })
}

function isEligible(post: NonNullable<Awaited<ReturnType<typeof loadScheduledPost>>>): boolean {
  return (
    post.channelConnection.status === 'ACTIVE' &&
    post.variant.status === 'APPROVED' &&
    post.variant.approval?.status === 'APPROVED'
  )
}

async function createPublicationAttempt(organizationId: string, scheduledPostId: string) {
  return prisma.$transaction(async (transaction) => {
    const attemptNumber =
      (await transaction.publicationAttempt.count({ where: { scheduledPostId } })) + 1
    return transaction.publicationAttempt.create({
      data: { attemptNumber, organizationId, scheduledPostId },
    })
  })
}

async function completePublication(
  post: NonNullable<Awaited<ReturnType<typeof loadScheduledPost>>>,
  attemptId: string,
  providerPostId: string
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.publicationAttempt.update({
      data: { completedAt: new Date(), outcome: 'SUCCEEDED', providerPostId },
      where: { id: attemptId },
    })
    await transaction.scheduledPost.update({
      data: { status: 'PUBLISHED' },
      where: { id: post.id },
    })
    await appendAuditLog(transaction, {
      action: 'post.published',
      actor: getAuditActor(getTriggerPrincipal(post.organizationId, post.id)),
      entityId: post.id,
      entityType: 'scheduled_post',
      organizationId: post.organizationId,
      requestId: post.id,
    })
  })
}

function canRetry(error: unknown, attemptNumber: number): boolean {
  return (
    error instanceof PostizProviderError &&
    error.status === 429 &&
    attemptNumber < maxPublicationAttempts
  )
}

async function failPublication(
  post: NonNullable<Awaited<ReturnType<typeof loadScheduledPost>>>,
  attempt: { attemptNumber: number; id: string },
  error: unknown
): Promise<void> {
  const failureCode =
    error instanceof PostizProviderError ? String(error.status ?? 'NETWORK') : 'UNKNOWN'
  const retry = canRetry(error, attempt.attemptNumber)
  await prisma.$transaction(async (transaction) => {
    await transaction.publicationAttempt.update({
      data: { completedAt: new Date(), failureCode, outcome: 'FAILED' },
      where: { id: attempt.id },
    })
    await transaction.scheduledPost.update({
      data: { status: retry ? 'SCHEDULED' : 'FAILED' },
      where: { id: post.id },
    })
    await appendAuditLog(transaction, {
      action: 'post.publish_failed',
      actor: getAuditActor(getTriggerPrincipal(post.organizationId, post.id)),
      entityId: post.id,
      entityType: 'scheduled_post',
      metadata: { failureCode, retry },
      organizationId: post.organizationId,
      outcome: 'FAILED',
      requestId: post.id,
    })
  })
}

async function dispatchClaimedPost(id: string): Promise<void> {
  const post = await loadScheduledPost(id)
  if (!post) {
    return
  }
  if (!(await isWorkspaceOperational(post.organizationId)) || !isEligible(post)) {
    await cancelIneligiblePost(post.id, post.organizationId)
    return
  }

  const attempt = await createPublicationAttempt(post.organizationId, post.id)
  try {
    const providerPostId = await publishPostizPost({
      asset: post.variant.sourceAsset,
      caption: post.caption,
      destinationId: post.channelConnection.externalAccountId,
      organizationId: post.organizationId,
      platform: post.channelConnection.platform,
      providerSettings: post.channelConnection.providerSettings,
      secretReference: post.channelConnection.secretReference,
    })
    await completePublication(post, attempt.id, providerPostId)
  } catch (error) {
    await failPublication(post, attempt, error)
  }
}

export async function dispatchDueScheduledPosts(): Promise<number> {
  await recoverStaleScheduledPosts()
  const posts = await prisma.scheduledPost.findMany({
    orderBy: { scheduledFor: 'asc' },
    select: { id: true },
    take: 100,
    where: { scheduledFor: { lte: new Date() }, status: 'SCHEDULED' },
  })
  let dispatched = 0
  for (const post of posts) {
    if (await claimScheduledPost(post.id)) {
      await dispatchClaimedPost(post.id)
      dispatched += 1
    }
  }
  return dispatched
}

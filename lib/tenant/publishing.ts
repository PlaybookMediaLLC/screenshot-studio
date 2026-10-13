import 'server-only'

import { appendAuditLog } from '@/lib/audit/log'
import { getAuditActor, type TriggerServicePrincipal } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import { isWorkspaceOperational } from '@/lib/workspace/access'
import { getPostizPostStatus, PostizProviderError, publishPostizPost } from './postiz'

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
      attempts: { some: { completedAt: null, providerPostId: null } },
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
  post: { id: string; organizationId: string },
  attemptId: string
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const completed = await transaction.publicationAttempt.updateMany({
      data: { completedAt: new Date(), outcome: 'SUCCEEDED' },
      where: { id: attemptId, completedAt: null, providerPostId: { not: null } },
    })
    if (completed.count === 0) return
    await transaction.scheduledPost.updateMany({
      data: { status: 'PUBLISHED' },
      where: { id: post.id, status: 'PROCESSING' },
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

async function acceptPublication(
  post: { id: string; organizationId: string },
  attemptId: string,
  providerPostId: string
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.publicationAttempt.update({
      data: { providerPostId },
      where: { id: attemptId },
    })
    await appendAuditLog(transaction, {
      action: 'post.accepted_by_scheduler',
      actor: getAuditActor(getTriggerPrincipal(post.organizationId, post.id)),
      entityId: post.id,
      entityType: 'scheduled_post',
      metadata: { providerPostId },
      organizationId: post.organizationId,
      requestId: post.id,
    })
  })
}

async function reconcileAcceptedPosts(): Promise<void> {
  const posts = await prisma.scheduledPost.findMany({
    include: {
      attempts: { orderBy: { attemptNumber: 'desc' }, take: 1 },
      channelConnection: { select: { secretReference: true } },
    },
    orderBy: { updatedAt: 'asc' },
    take: 100,
    where: {
      attempts: { some: { completedAt: null, providerPostId: { not: null } } },
      status: 'PROCESSING',
    },
  })
  for (let offset = 0; offset < posts.length; offset += 10) {
    await Promise.all(
      posts.slice(offset, offset + 10).map(async (post) => {
        const attempt = post.attempts[0]
        if (!attempt?.providerPostId || attempt.completedAt) return
        try {
          const receipt = await getPostizPostStatus(
            post.channelConnection.secretReference,
            attempt.providerPostId
          )
          if (
            receipt.state === 'PUBLISHED' &&
            receipt.releaseId &&
            receipt.releaseId !== 'missing'
          ) {
            await completePublication(post, attempt.id)
          } else if (receipt.state === 'ERROR') {
            await prisma.$transaction(async (transaction) => {
              const failed = await transaction.publicationAttempt.updateMany({
                data: { completedAt: new Date(), failureCode: 'PROVIDER_ERROR', outcome: 'FAILED' },
                where: { id: attempt.id, completedAt: null },
              })
              if (failed.count === 0) return
              await transaction.scheduledPost.updateMany({
                data: { status: 'FAILED' },
                where: { id: post.id, status: 'PROCESSING' },
              })
              await appendAuditLog(transaction, {
                action: 'post.publish_failed',
                actor: getAuditActor(getTriggerPrincipal(post.organizationId, post.id)),
                entityId: post.id,
                entityType: 'scheduled_post',
                metadata: { failureCode: 'PROVIDER_ERROR', retry: false },
                organizationId: post.organizationId,
                outcome: 'FAILED',
                requestId: post.id,
              })
            })
          }
        } catch {
          // Preserve the accepted post and its remote ID. A later poll can
          // recover from a temporary API failure without a duplicate create.
        } finally {
          // Move this post behind other pending receipts so a stalled provider
          // cannot starve newer posts when the batch exceeds 100.
          await prisma.scheduledPost
            .updateMany({
              data: { updatedAt: new Date() },
              where: { id: post.id, status: 'PROCESSING' },
            })
            .catch(() => undefined)
        }
      })
    )
  }
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
  const binding = await prisma.postizTenantBinding.findUnique({
    where: { organizationId: post.organizationId },
  })
  if (!(await isWorkspaceOperational(post.organizationId)) || !isEligible(post)) {
    await cancelIneligiblePost(post.id, post.organizationId)
    return
  }

  const attempt = await createPublicationAttempt(post.organizationId, post.id)
  if (!binding || binding.secretReference !== post.channelConnection.secretReference) {
    await failPublication(
      post,
      attempt,
      new PostizProviderError('Postiz organization binding is unavailable.', 403)
    )
    return
  }
  let providerPostId: string
  try {
    providerPostId = await publishPostizPost({
      asset: post.variant.sourceAsset,
      caption: post.caption,
      destinationId: post.channelConnection.externalAccountId,
      expectedGoOrganizationId: binding.goOrganizationId,
      organizationId: post.organizationId,
      platform: post.channelConnection.platform,
      providerSettings: post.channelConnection.providerSettings,
      secretReference: post.channelConnection.secretReference,
    })
  } catch (error) {
    await failPublication(post, attempt, error)
    return
  }
  await acceptPublication(post, attempt.id, providerPostId)
}

export async function dispatchDueScheduledPosts(): Promise<number> {
  await recoverStaleScheduledPosts()
  await reconcileAcceptedPosts()
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

import 'server-only'

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { appendAuditLog } from '@/lib/audit/log'
import type { TenantContext } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import type { ChannelConnectionCreateInput, ScheduledPostCreateInput } from './schemas'

type CreateScheduledPostInput = ScheduledPostCreateInput & { idempotencyKey: string }

const postSelect = {
  caption: true,
  channelConnectionId: true,
  createdAt: true,
  id: true,
  scheduledFor: true,
  status: true,
  variantId: true,
} as const

export class ScheduledPostError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message)
    this.name = 'ScheduledPostError'
  }
}

function getConnectionCreatorId(context: TenantContext): string {
  if (context.principal.kind !== 'session') {
    throw new ScheduledPostError('A signed-in publisher is required.', 400)
  }
  return context.principal.userId
}

async function createChannelConnectionInTransaction(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  input: ChannelConnectionCreateInput
) {
  const connection = await transaction.channelConnection.create({
    data: {
      createdByUserId: getConnectionCreatorId(context),
      externalAccountId: input.externalAccountId,
      organizationId: context.organizationId,
      platform: input.platform,
      provider: 'postiz',
      providerSettings: input.providerSettings,
      secretReference: input.secretReference,
    },
  })
  await appendAuditLog(transaction, {
    action: 'post.connection_created',
    actor: getAuditActor(context.principal),
    entityId: connection.id,
    entityType: 'channel_connection',
    organizationId: context.organizationId,
    requestId: context.requestId,
  })
  return connection
}

export async function createPostizConnection(
  context: TenantContext,
  input: ChannelConnectionCreateInput
) {
  try {
    return await prisma.$transaction((transaction) =>
      createChannelConnectionInTransaction(transaction, context, input)
    )
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ScheduledPostError('This Postiz destination is already connected.', 409)
    }
    throw error
  }
}

async function findScheduleInputs(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  input: CreateScheduledPostInput
) {
  const [connection, variant] = await Promise.all([
    transaction.channelConnection.findFirst({
      where: {
        id: input.channelConnectionId,
        organizationId: context.organizationId,
        provider: 'postiz',
        status: 'ACTIVE',
      },
    }),
    transaction.creativeVariant.findFirst({
      where: {
        approval: { is: { status: 'APPROVED' } },
        id: input.variantId,
        organizationId: context.organizationId,
        status: 'APPROVED',
      },
    }),
  ])
  if (!connection || !variant) {
    throw new ScheduledPostError('The destination or approved variant was not found.', 404)
  }
}

async function findIdempotentPost(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  input: CreateScheduledPostInput
) {
  return transaction.scheduledPost.findFirst({
    select: postSelect,
    where: {
      channelConnectionId: input.channelConnectionId,
      idempotencyKey: input.idempotencyKey,
      organizationId,
    },
  })
}

async function createScheduledPostInTransaction(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  input: CreateScheduledPostInput
) {
  const existing = await findIdempotentPost(transaction, context.organizationId, input)
  if (existing) {
    return { created: false, scheduledPost: existing }
  }

  await findScheduleInputs(transaction, context, input)
  const scheduledPost = await transaction.scheduledPost.create({
    data: {
      caption: input.caption,
      channelConnectionId: input.channelConnectionId,
      idempotencyKey: input.idempotencyKey,
      organizationId: context.organizationId,
      scheduledFor: input.scheduledFor,
      status: 'SCHEDULED',
      variantId: input.variantId,
    },
    select: postSelect,
  })
  await appendAuditLog(transaction, {
    action: 'post.scheduled',
    actor: getAuditActor(context.principal),
    entityId: scheduledPost.id,
    entityType: 'scheduled_post',
    organizationId: context.organizationId,
    requestId: context.requestId,
  })
  return { created: true, scheduledPost }
}

export async function createScheduledPost(context: TenantContext, input: CreateScheduledPostInput) {
  try {
    return await prisma.$transaction((transaction) =>
      createScheduledPostInTransaction(transaction, context, input)
    )
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error
    }
    const scheduledPost = await prisma.scheduledPost.findFirst({
      select: postSelect,
      where: {
        channelConnectionId: input.channelConnectionId,
        idempotencyKey: input.idempotencyKey,
        organizationId: context.organizationId,
      },
    })
    if (!scheduledPost) {
      throw error
    }
    return { created: false, scheduledPost }
  }
}

export async function listScheduledPosts(organizationId: string, take: number) {
  return prisma.scheduledPost.findMany({
    orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
    select: {
      ...postSelect,
      channelConnection: { select: { externalAccountId: true, platform: true, provider: true } },
    },
    take,
    where: { organizationId },
  })
}

export async function cancelScheduledPost(context: TenantContext, scheduledPostId: string) {
  return prisma.$transaction(async (transaction) => {
    const post = await transaction.scheduledPost.findFirst({
      select: postSelect,
      where: { id: scheduledPostId, organizationId: context.organizationId },
    })
    if (!post) {
      throw new ScheduledPostError('Scheduled post was not found.', 404)
    }
    if (post.status === 'PUBLISHED' || post.status === 'PROCESSING') {
      throw new ScheduledPostError('This scheduled post can no longer be cancelled.', 409)
    }
    if (post.status === 'CANCELLED') {
      return post
    }

    const cancelled = await transaction.scheduledPost.update({
      data: { status: 'CANCELLED' },
      select: postSelect,
      where: { id: post.id },
    })
    await appendAuditLog(transaction, {
      action: 'post.cancelled',
      actor: getAuditActor(context.principal),
      entityId: cancelled.id,
      entityType: 'scheduled_post',
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return cancelled
  })
}

export function getScheduledPostIdempotencyKey(requestId: string | null): string {
  return requestId?.slice(0, 128) || randomUUID()
}

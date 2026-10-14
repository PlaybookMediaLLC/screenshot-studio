import 'server-only'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import {
  cancelBackendScheduledPost,
  createBackendConnection,
  createBackendScheduledPost,
  listBackendConnections,
  listBackendScheduledPosts,
  publishingBackendEnabled,
} from '@/lib/tenant/publishing-backend'
import {
  cancelScheduledPost,
  createPostizConnection,
  createScheduledPost,
  getScheduledPostIdempotencyKey,
  listScheduledPosts,
} from '@/lib/tenant/scheduled-posts'
import {
  channelConnectionCreateSchema,
  scheduledPostCreateSchema,
  scheduledPostListQuerySchema,
} from '@/lib/tenant/schemas'
import { router } from '../init'
import { organizationProcedure, sensitiveOrganizationProcedure } from '../procedures'

export const channelConnectionRouter = router({
  list: organizationProcedure('publish:manage').query(async ({ ctx }) => {
    if (publishingBackendEnabled()) {
      return { connections: await listBackendConnections(ctx.access) }
    }
    const connections = await prisma.channelConnection.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        externalAccountId: true,
        id: true,
        platform: true,
        provider: true,
        providerSettings: true,
        status: true,
      },
      where: { organizationId: ctx.access.organizationId },
    })
    return { connections }
  }),
  create: sensitiveOrganizationProcedure('publish:manage')
    .input(channelConnectionCreateSchema)
    .mutation(async ({ ctx, input }) => {
      let connection
      if (publishingBackendEnabled()) {
        connection = await createBackendConnection(ctx.access, input)
      } else {
        connection = await createPostizConnection(ctx.access, input)
      }
      return { connection }
    }),
})

export const scheduledPostRouter = router({
  list: organizationProcedure('publish:manage')
    .input(scheduledPostListQuerySchema.optional())
    .query(async ({ ctx, input }) => {
      const scheduledPosts = publishingBackendEnabled()
        ? await listBackendScheduledPosts(ctx.access, input?.limit ?? 50)
        : await listScheduledPosts(ctx.access.organizationId, input?.limit ?? 50)
      return { scheduledPosts }
    }),
  create: sensitiveOrganizationProcedure('publish:manage')
    .input(
      scheduledPostCreateSchema.extend({
        idempotencyKey: z.string().trim().min(1).max(128).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { idempotencyKey, ...post } = input
      const createInput = {
        ...post,
        idempotencyKey: getScheduledPostIdempotencyKey(idempotencyKey ?? null),
      }
      return publishingBackendEnabled()
        ? createBackendScheduledPost(ctx.access, createInput)
        : createScheduledPost(ctx.access, createInput)
    }),
  cancel: sensitiveOrganizationProcedure('publish:manage')
    .input(z.object({ scheduledPostId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      return publishingBackendEnabled()
        ? cancelBackendScheduledPost(ctx.access, input.scheduledPostId)
        : { scheduledPost: await cancelScheduledPost(ctx.access, input.scheduledPostId) }
    }),
})

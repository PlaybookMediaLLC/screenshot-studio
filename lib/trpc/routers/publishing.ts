import 'server-only'

import { z } from 'zod'
import { prisma } from '@/lib/db'
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
      const connection = await createPostizConnection(ctx.access, input)
      return { connection }
    }),
})

export const scheduledPostRouter = router({
  list: organizationProcedure('publish:manage')
    .input(scheduledPostListQuerySchema.optional())
    .query(async ({ ctx, input }) => {
      const scheduledPosts = await listScheduledPosts(ctx.access.organizationId, input?.limit ?? 50)
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
      return createScheduledPost(ctx.access, {
        ...post,
        idempotencyKey: getScheduledPostIdempotencyKey(idempotencyKey ?? null),
      })
    }),
  cancel: sensitiveOrganizationProcedure('publish:manage')
    .input(z.object({ scheduledPostId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const scheduledPost = await cancelScheduledPost(ctx.access, input.scheduledPostId)
      return { scheduledPost }
    }),
})

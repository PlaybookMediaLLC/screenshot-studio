import 'server-only'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  addAudienceSubscribers,
  AnnouncementError,
  cancelAnnouncement,
  getAudienceReach,
  listAnnouncements,
  listAudienceSubscribers,
  scheduleAnnouncement,
} from '@/lib/tenant/announcements'
import {
  announcementListQuerySchema,
  announcementScheduleSchema,
  audienceListQuerySchema,
  audienceSubscriberCreateSchema,
} from '@/lib/tenant/schemas'
import { router } from '../init'
import { organizationProcedure, sensitiveOrganizationProcedure } from '../procedures'

const idempotencyKeySchema = z.string().trim().min(1).max(128).optional()

/**
 * Release announcements to customer audiences.
 *
 * Scheduling requires `publish:manage` rather than `artifact:edit`.
 * Announcing is the irreversible customer-facing step, so it sits with
 * the permission that already governs publishing rather than with
 * content editing.
 */
export const announcementRouter = router({
  list: organizationProcedure('publish:manage')
    .input(announcementListQuerySchema.optional())
    .query(async ({ ctx, input }) => {
      const announcements = await listAnnouncements(ctx.access.organizationId, input?.limit ?? 50)
      return { announcements }
    }),

  reach: organizationProcedure('publish:manage').query(async ({ ctx }) => {
    return { reach: await getAudienceReach(ctx.access.organizationId) }
  }),

  schedule: sensitiveOrganizationProcedure('publish:manage')
    .input(announcementScheduleSchema.extend({ idempotencyKey: idempotencyKeySchema }))
    .mutation(async ({ ctx, input }) => {
      const { idempotencyKey, ...announcement } = input
      // AnnouncementError is registered in errors.ts, so its status maps
      // to the matching tRPC code without a local translation layer.
      return scheduleAnnouncement(ctx.access, {
        ...announcement,
        idempotencyKey: idempotencyKey ?? randomUUID(),
      })
    }),

  cancel: sensitiveOrganizationProcedure('publish:manage')
    .input(z.object({ announcementId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const cancelled = await cancelAnnouncement(ctx.access, input.announcementId)
      if (!cancelled) {
        throw new AnnouncementError('Only a scheduled announcement can be cancelled.', 409)
      }
      return { cancelled }
    }),
})

export const audienceRouter = router({
  list: organizationProcedure('publish:manage')
    .input(audienceListQuerySchema.optional())
    .query(async ({ ctx, input }) => {
      const subscribers = await listAudienceSubscribers(ctx.access.organizationId, {
        includeUnsubscribed: input?.includeUnsubscribed ?? false,
        limit: input?.limit ?? 100,
      })
      return { subscribers }
    }),

  add: sensitiveOrganizationProcedure('publish:manage')
    .input(audienceSubscriberCreateSchema)
    .mutation(async ({ ctx, input }) => {
      return addAudienceSubscribers(ctx.access, input)
    }),
})

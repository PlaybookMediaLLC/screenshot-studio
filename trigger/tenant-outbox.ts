import { schedules } from '@trigger.dev/sdk'
import { dispatchDueCommunications } from '@/lib/tenant/communications'
import { dispatchPendingTenantOutboxEvents } from '@/lib/tenant/outbox'
import { dispatchDueScheduledPosts } from '@/lib/tenant/publishing'

export const dispatchTenantOutbox = schedules.task({
  cron: '*/1 * * * *',
  id: 'dispatch-tenant-outbox',
  run: async (): Promise<{ announced: number; dispatched: number; published: number }> => {
    const [dispatched, published, announced] = await Promise.all([
      dispatchPendingTenantOutboxEvents(),
      dispatchDueScheduledPosts(),
      dispatchDueCommunications(),
    ])
    return { announced, dispatched, published }
  },
})

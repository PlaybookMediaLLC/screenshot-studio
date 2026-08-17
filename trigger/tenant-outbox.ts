import { schedules } from '@trigger.dev/sdk'
import { dispatchPendingTenantOutboxEvents } from '@/lib/tenant/outbox'
import { dispatchDueScheduledPosts } from '@/lib/tenant/publishing'

export const dispatchTenantOutbox = schedules.task({
  cron: '*/1 * * * *',
  id: 'dispatch-tenant-outbox',
  run: async (): Promise<{ dispatched: number; published: number }> => {
    const [dispatched, published] = await Promise.all([
      dispatchPendingTenantOutboxEvents(),
      dispatchDueScheduledPosts(),
    ])
    return { dispatched, published }
  },
})

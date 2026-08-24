import { schedules } from '@trigger.dev/sdk'
import { dispatchDueCommunications } from '@/lib/tenant/communications'
import { dispatchPendingTenantOutboxEvents } from '@/lib/tenant/outbox'
import { dispatchDueScheduledPosts } from '@/lib/tenant/publishing'
import { purgeDueWorkspaceDeletions } from '@/lib/workspace/service'

export const dispatchTenantOutbox = schedules.task({
  cron: '*/1 * * * *',
  id: 'dispatch-tenant-outbox',
  run: async (): Promise<{
    announced: number
    dispatched: number
    published: number
    purged: number
  }> => {
    const [dispatched, published, announced, purged] = await Promise.all([
      dispatchPendingTenantOutboxEvents(),
      dispatchDueScheduledPosts(),
      dispatchDueCommunications(),
      purgeDueWorkspaceDeletions(),
    ])
    return { announced, dispatched, published, purged }
  },
})

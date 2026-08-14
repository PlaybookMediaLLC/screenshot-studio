import { schedules } from '@trigger.dev/sdk'
import { dispatchPendingAuditDrains } from '@/lib/audit/drains'

export const dispatchAuditDrains = schedules.task({
  cron: '*/1 * * * *',
  id: 'dispatch-audit-drains',
  run: async (): Promise<{ dispatched: number }> => ({
    dispatched: await dispatchPendingAuditDrains(),
  }),
})

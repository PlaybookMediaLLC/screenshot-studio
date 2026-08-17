import { schedules } from '@trigger.dev/sdk'
import { purgeExpiredAuditLogs } from '@/lib/audit/retention'

export const purgeAuditLogs = schedules.task({
  cron: '5 3 * * *',
  id: 'purge-expired-audit-logs',
  run: async (): Promise<{ deleted: number }> => ({ deleted: await purgeExpiredAuditLogs() }),
})

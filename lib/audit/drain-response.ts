import type { AuditDrain } from '@prisma/client'

export function toAuditDrainResponse(drain: AuditDrain) {
  return {
    createdAt: drain.createdAt,
    enabled: drain.enabled,
    endpoint: drain.endpoint,
    id: drain.id,
    name: drain.name,
    provider: drain.provider,
    updatedAt: drain.updatedAt,
  }
}

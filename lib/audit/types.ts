import type { AuditOutcome } from '@prisma/client'
import type { AuditActor } from '@/lib/auth/principal'
import type { AuditMetadata } from './metadata'

export const auditActions = [
  'audit.drain_created',
  'audit.drain_deleted',
  'audit.log_exported',
  'audit.log_read',
  'audit.retention_changed',
  'auth.session_revoked',
  'identity.scim_token_created',
  'identity.scim_connection_removed',
  'identity.sso_configured',
  'identity.sso_removed',
  'post.cancelled',
  'post.connection_created',
  'post.publish_failed',
  'post.publish_recovery_required',
  'post.published',
  'post.scheduled',
  'support.access_granted',
  'support.access_revoked',
] as const

export type AuditAction = (typeof auditActions)[number] | `product.${string}`

export type AuditLogInput = {
  action: AuditAction
  actor: AuditActor
  entityId?: string
  entityType: string
  ipHash?: string
  metadata?: AuditMetadata
  organizationId: string
  outcome?: AuditOutcome
  requestId: string
  userAgentSummary?: string
}

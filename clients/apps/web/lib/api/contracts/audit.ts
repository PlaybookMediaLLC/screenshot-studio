import { z } from 'zod'
import type {
  AuditLogPage,
  BackendAuditDrain,
  BackendAuditRetention,
  BackendWorkspaceEntitlement,
} from 'screenshot-studio-backend-sdk'
import { defineContract, mirrors } from '@/lib/api/contract'
import {
  auditDrainCreateSchema,
  auditDrainListSchema,
  validateDrainEndpoint,
} from '@/lib/audit/drain-schema'
import { auditLogQuerySchema } from '@/lib/audit/query'
import { auditRetentionQuerySchema, auditRetentionUpdateSchema } from '@/lib/audit/retention-schema'

/**
 * Audit and enterprise-control contracts. These serve the workspace settings
 * UI under a session; they are not part of the public OpenAPI surface.
 */

/** Outcomes recorded on an audit event. */
export const auditOutcomeSchema = z.enum(['SUCCEEDED', 'FAILED', 'DENIED'])

/** Who performed an audited action. */
export const auditActorTypeSchema = z.enum(['USER', 'SERVICE', 'SUPPORT', 'WEBHOOK'])

/** Destinations an audit drain can deliver to. */
export const auditDrainProviderSchema = z.enum(['DATADOG', 'GENERIC', 'SPLUNK'])

/** One page of the audit log. */
export const auditLogPageSchema = mirrors<AuditLogPage>()(
  z.object({
    items: z.array(
      z.object({
        action: z.string(),
        actorDisplay: z.string().nullable(),
        actorType: auditActorTypeSchema,
        actorUserId: z.string().nullable(),
        createdAt: z.string(),
        entityId: z.string().nullable(),
        entityType: z.string(),
        id: z.string(),
        ipHash: z.string().nullable(),
        metadata: z.record(z.string(), z.unknown()).nullable(),
        organizationId: z.string(),
        outcome: auditOutcomeSchema,
        requestId: z.string(),
        searchText: z.string(),
        userAgentSummary: z.string().nullable(),
      })
    ),
    nextCursor: z.string().optional(),
  })
)

/** An audit drain, without its signing secret. */
export const auditDrainSchema = mirrors<BackendAuditDrain>()(
  z.object({
    createdAt: z.string(),
    enabled: z.boolean(),
    endpoint: z.string(),
    id: z.string(),
    name: z.string(),
    provider: auditDrainProviderSchema,
    updatedAt: z.string(),
  })
)

/** The audit retention policy. */
export const auditRetentionSchema = mirrors<BackendAuditRetention>()(
  z.object({ legalHold: z.boolean(), retentionDays: z.number() })
)

/** A drain endpoint must be public, and HTTPS in production. */
export const auditDrainCreateBodySchema = auditDrainCreateSchema.superRefine((input, context) => {
  try {
    validateDrainEndpoint(input.endpoint)
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Invalid drain endpoint.',
      path: ['endpoint'],
    })
  }
})

/** `GET /api/audit-logs` */
export const listAuditLogsContract = defineContract({
  method: 'GET',
  name: 'audit-logs.list',
  output: auditLogPageSchema,
  path: '/api/audit-logs',
  query: auditLogQuerySchema,
  summary: 'Page through the organization audit log',
})

/** `GET /api/enterprise/audit-drains` */
export const listAuditDrainsContract = defineContract({
  method: 'GET',
  name: 'audit-drains.list',
  output: z.object({ drains: z.array(auditDrainSchema) }),
  path: '/api/enterprise/audit-drains',
  query: auditDrainListSchema,
  summary: 'List audit drains',
})

/** `POST /api/enterprise/audit-drains` */
export const createAuditDrainContract = defineContract({
  body: auditDrainCreateBodySchema,
  method: 'POST',
  name: 'audit-drains.create',
  output: z.object({ drain: auditDrainSchema }),
  path: '/api/enterprise/audit-drains',
  status: 201,
  summary: 'Add an audit drain',
})

/** `DELETE /api/enterprise/audit-drains/{drainId}` */
export const deleteAuditDrainContract = defineContract({
  method: 'DELETE',
  name: 'audit-drains.delete',
  output: z.undefined(),
  params: z.object({ drainId: z.string().min(1) }),
  path: '/api/enterprise/audit-drains/{drainId}',
  query: auditDrainListSchema,
  status: 204,
  summary: 'Remove an audit drain',
})

/** `GET /api/enterprise/audit-retention` */
export const getAuditRetentionContract = defineContract({
  method: 'GET',
  name: 'audit-retention.get',
  output: auditRetentionSchema,
  path: '/api/enterprise/audit-retention',
  query: auditRetentionQuerySchema,
  summary: 'Get the audit retention policy',
})

/** `PUT /api/enterprise/audit-retention` */
export const updateAuditRetentionContract = defineContract({
  body: auditRetentionUpdateSchema,
  method: 'PUT',
  name: 'audit-retention.update',
  output: auditRetentionSchema,
  path: '/api/enterprise/audit-retention',
  summary: 'Change the audit retention policy',
})

/** `GET /api/enterprise/entitlement` */
export const getEntitlementContract = defineContract({
  method: 'GET',
  name: 'enterprise.entitlement',
  output: z.object({
    entitlement: mirrors<BackendWorkspaceEntitlement>()(
      z.object({
        featureOverrides: z.record(z.string(), z.boolean()).nullable(),
        graceUntil: z.string().nullable(),
        lastSyncedAt: z.string().nullable(),
        plan: z.string(),
        status: z.string(),
        validUntil: z.string().nullable(),
        version: z.number(),
      })
    ),
  }),
  path: '/api/enterprise/entitlement',
  summary: 'Get the contract entitlement',
})

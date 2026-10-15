import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'
import { emptyRequestSchema } from '@/lib/api/schemas'

/**
 * Internal contracts: called by billing and by operators, never by browsers,
 * and not part of the public OpenAPI surface.
 */

/** `POST /api/internal/billing/entitlements`: a signed billing event, read as raw text. */
export const syncBillingEntitlementContract = defineContract({
  body: z.string(),
  bodyFormat: 'text',
  method: 'POST',
  name: 'billing.entitlements.sync',
  output: z.object({ replayed: z.boolean(), version: z.number() }),
  path: '/api/internal/billing/entitlements',
  status: 202,
  summary: 'Apply a signed billing entitlement event',
})

/** `POST /api/internal/tenant-outbox/{eventId}/replay` */
export const replayOutboxEventContract = defineContract({
  body: emptyRequestSchema,
  method: 'POST',
  name: 'tenant-outbox.replay',
  output: z.object({ replayed: z.literal(true) }),
  params: z.object({ eventId: z.string().min(1) }),
  path: '/api/internal/tenant-outbox/{eventId}/replay',
  summary: 'Requeue a dead-lettered outbox event',
})

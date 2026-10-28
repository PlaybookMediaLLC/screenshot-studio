import { z } from 'zod'
import {
  githubProductionStateSchema,
  githubPolicyVersionSchema,
  githubProductionDecisionSchema,
  githubProductionCatalogSchema,
  githubRecoverySchema,
  saveGitHubProductionSchema,
  previewGitHubProductionSchema,
} from 'screenshot-studio-backend-sdk'
import { defineContract } from '@/lib/api/contract'
import { memberDocs } from './workspace-docs'

const params = z.object({ sourceId: z.string().min(1).max(64) })
const read = { permission: 'workspace:read' } as const
const manage = { permission: 'workspace:update' } as const
/** Read policies, observations, pinned versions, and decisions. */
export const getGitHubProductionContract = defineContract({
  access: read,
  method: 'GET',
  name: 'github.production.get',
  path: '/api/v1/github/sources/{sourceId}/production',
  params,
  query: z.object({ cursor: z.string().max(64).optional() }),
  output: githubProductionStateSchema,
  summary: 'Inspect production evidence',
  docs: memberDocs({
    operationId: 'getGitHubProduction',
    description: 'Session-only, tenant-scoped production evidence and policy history.',
    tag: 'Workspace',
    responses: { '200': 'Production evidence.', '404': 'Source not found.' },
  }),
})
/** Save an immutable policy revision; an enabled policy applies to new events only. */
export const saveGitHubProductionContract = defineContract({
  access: manage,
  method: 'PUT',
  name: 'github.production.save',
  path: '/api/v1/github/sources/{sourceId}/production',
  params,
  body: saveGitHubProductionSchema,
  output: githubPolicyVersionSchema,
  summary: 'Configure production evidence',
  docs: memberDocs({
    operationId: 'saveGitHubProduction',
    description:
      'Owners and administrators select GitHub evidence and a Shots workflow. Uses an expected revision; does not replay history.',
    tag: 'Workspace',
    responses: {
      '200': 'Policy revision saved.',
      '400': 'Invalid policy.',
      '409': 'Revision conflict or inactive Shots workflow.',
    },
  }),
})
/** Preview without provider calls or any durable side effect. */
export const previewGitHubProductionContract = defineContract({
  access: read,
  method: 'POST',
  name: 'github.production.preview',
  path: '/api/v1/github/sources/{sourceId}/production-preview',
  params,
  body: previewGitHubProductionSchema,
  output: githubProductionDecisionSchema,
  summary: 'Preview production policy',
  docs: memberDocs({
    operationId: 'previewGitHubProduction',
    description:
      'Evaluates a saved observation or example with no writes, enrichment, credits, or execution.',
    tag: 'Workspace',
    responses: {
      '200': 'Condition explanations.',
      '400': 'Invalid example.',
      '404': 'Source or observation not found.',
    },
  }),
})
/** Discover provider capabilities, stable workflows and exact-attempt jobs. */
export const getGitHubProductionCatalogContract = defineContract({
  access: read,
  method: 'GET',
  name: 'github.production.catalog',
  path: '/api/v1/github/sources/{sourceId}/production-catalog',
  params,
  query: z.object({
    runId: z.coerce.number().int().nonnegative().optional(),
    attempt: z.coerce.number().int().nonnegative().optional(),
  }),
  output: githubProductionCatalogSchema,
  summary: 'Inspect GitHub deployment capabilities',
  docs: memberDocs({
    operationId: 'getGitHubProductionCatalog',
    description:
      'Reports missing permissions or subscriptions without blocking existing event types.',
    tag: 'Workspace',
    responses: { '200': 'Capabilities and available selections.', '404': 'Source not found.' },
  }),
})
/** Read failed delivery and incomplete-history status. */
export const getGitHubRecoveryContract = defineContract({
  access: read,
  method: 'GET',
  name: 'github.recovery.get',
  path: '/api/v1/github/sources/{sourceId}/delivery-recovery',
  params,
  output: githubRecoverySchema,
  summary: 'Inspect GitHub delivery recovery',
  docs: memberDocs({
    operationId: 'getGitHubRecovery',
    description: 'Tenant-scoped provider-delivery status and history gaps.',
    tag: 'Workspace',
    responses: { '200': 'Recovery status.', '404': 'Source not found.' },
  }),
})
/** Scan one bounded page, optionally redelivering failed events for review only. */
export const inspectGitHubRecoveryContract = defineContract({
  access: manage,
  method: 'POST',
  name: 'github.recovery.inspect',
  path: '/api/v1/github/sources/{sourceId}/delivery-recovery',
  params,
  body: z.object({ redeliver: z.boolean() }).strict(),
  output: githubRecoverySchema,
  summary: 'Recover GitHub deliveries for review',
  docs: memberDocs({
    operationId: 'inspectGitHubRecovery',
    description:
      'Owners/admins inspect a provider page; optional redelivery is bounded to five requests and three attempts. Recovered events cannot run live workflows.',
    tag: 'Workspace',
    responses: {
      '200': 'Progress, backoff, or failure status.',
      '503': 'GitHub recovery unavailable.',
    },
  }),
})

import { z } from 'zod'
import { defineContract, mirrors, timestampSchema } from '@/lib/api/contract'
import { idempotencyKeySchema } from '@/lib/api/contracts/releases'
import { workspaceDocs } from '@/lib/api/contracts/workspace-docs'
import { idealCustomerProfileFieldSchema } from '@/lib/tenant/ideal-customer-profile-schema'
import type {
  cancelOnboardingRun,
  getOnboardingRun,
  listOnboardingEnrichment,
  startOnboardingRun,
} from '@/lib/tenant/onboarding-runs'
import {
  productProfileFieldSchema,
  productProfileValuesSchema,
} from '@/lib/tenant/product-profile-schema'

/** An onboarding run's lifecycle state (docs/rfcs/032-background-onboarding-agent.md). */
export const onboardingRunStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
])

/** One onboarding run: its stage, monotonic progress, and the budgets it used. */
export const onboardingRunSchema = z.object({
  completedAt: timestampSchema.nullable(),
  completedStages: z.array(z.string()),
  createdByUserId: z.string().nullable(),
  deadlineAt: timestampSchema,
  discoveredUrls: z.array(z.string()),
  enrichmentCostMicros: z.number().int(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  fastPathMs: z.number().int(),
  id: z.string(),
  pageLimit: z.number().int(),
  pagesDiscovered: z.number().int(),
  pagesProcessed: z.number().int(),
  pagesSkipped: z.number().int(),
  progress: z.number().int().min(0).max(100),
  stage: z.string(),
  startedAt: timestampSchema,
  status: onboardingRunStatusSchema,
  tokenBudget: z.number().int(),
  tokensUsed: z.number().int(),
  updatedAt: timestampSchema,
  url: z.string(),
  workflowId: z.string(),
})

/** Where a profile field's value came from: a person, the product's site, or enrichment. */
export const fieldProvenanceSchema = z.object({
  confidence: z.number().min(0).max(1).optional(),
  editedByUser: z.boolean(),
  source: z.enum(['manual', 'automated', 'enrichment']),
  updatedAt: timestampSchema,
  url: z.string().optional(),
})

/** The workspace's product profile, as the fast path drafted it. */
export const onboardingProductProfileSchema = z.object({
  audience: z.string(),
  capabilities: z.array(z.string()),
  competitors: z.array(z.string()),
  createdAt: timestampSchema,
  id: z.string(),
  name: z.string(),
  pricingNote: z.string(),
  problem: z.string(),
  proofPoints: z.array(z.object({ claim: z.string(), sourceUrl: z.string().optional() })),
  provenance: z.partialRecord(productProfileFieldSchema, fieldProvenanceSchema),
  summary: z.string(),
  updatedAt: timestampSchema,
  url: z.string(),
})

/** The workspace's ideal customer profile, as the fast path drafted it. */
export const onboardingIdealCustomerProfileSchema = z.object({
  buyingTriggers: z.array(z.string()),
  channels: z.array(z.string()),
  createdAt: timestampSchema,
  id: z.string(),
  jobs: z.array(z.string()),
  objections: z.array(z.string()),
  pains: z.array(z.string()),
  personas: z.array(
    z.object({
      role: z.string(),
      seniority: z.string().optional(),
      teamSize: z.string().optional(),
    })
  ),
  provenance: z.partialRecord(idealCustomerProfileFieldSchema, fieldProvenanceSchema),
  updatedAt: timestampSchema,
})

/** The fast path's answer: the drafts and the run deepening them. */
export const onboardingStartSchema = z.object({
  created: z.boolean(),
  extracted: z.boolean(),
  idealCustomerProfile: onboardingIdealCustomerProfileSchema.nullable(),
  pages: z.array(z.string()),
  productProfile: onboardingProductProfileSchema.nullable(),
  reason: z.string().optional(),
  run: onboardingRunSchema,
})

/** A pasted product URL and, optionally, the founder's own one sentence. */
export const onboardingStartBodySchema = z.object({
  sentence: z.string().trim().max(300).optional(),
  url: productProfileValuesSchema.shape.url,
})

const runParamsSchema = z.object({ runId: z.string().min(1).max(64) })
const idempotencyHeadersSchema = z.object({ 'idempotency-key': idempotencyKeySchema.optional() })
const scope = 'Requires the `onboarding:run` scope.'

/** `POST /api/v1/onboarding-runs`: the fast path, then the background run. */
export const createOnboardingRunContract = defineContract({
  body: onboardingStartBodySchema,
  docs: workspaceDocs({
    bodyName: 'OnboardingRunCreateRequest',
    description: `Reads the product's site and returns a product profile and ideal customer profile draft within ten seconds, then starts the background run that deepens them. A second request while a run is active, or a replayed \`Idempotency-Key\`, returns the existing run with 200. ${scope}`,
    operationId: 'createOnboardingRun',
    responses: {
      '200': 'An existing run.',
      '201': 'Run started.',
      '400': 'The URL is invalid.',
      '429': 'The workspace started three runs this hour.',
    },
    tag: 'Workspace',
  }),
  headers: idempotencyHeadersSchema,
  method: 'POST',
  name: 'onboarding-runs.create',
  output: mirrors<Awaited<ReturnType<typeof startOnboardingRun>>>()(onboardingStartSchema),
  path: '/api/v1/onboarding-runs',
  status: 201,
  summary: 'Start an onboarding run',
})

/** `GET /api/v1/onboarding-runs/{runId}`: status and live progress. */
export const getOnboardingRunContract = defineContract({
  docs: workspaceDocs({
    description: `Returns a run's status, stage, and progress (0 to 100, never decreasing). While the run is active the progress is live. ${scope}`,
    operationId: 'getOnboardingRun',
    outputName: 'OnboardingRunResponse',
    responses: { '200': 'The run.', '404': 'No run with that ID exists in the workspace.' },
    tag: 'Workspace',
  }),
  method: 'GET',
  name: 'onboarding-runs.get',
  output: z.object({
    run: mirrors<Awaited<ReturnType<typeof getOnboardingRun>>>()(onboardingRunSchema),
  }),
  params: runParamsSchema,
  path: '/api/v1/onboarding-runs/{runId}',
  summary: 'Get an onboarding run',
})

/** `POST /api/v1/onboarding-runs/{runId}/cancel`. */
export const cancelOnboardingRunContract = defineContract({
  docs: workspaceDocs({
    description: `Stops an active run within seconds. Everything it already read is kept; cancelling a finished run changes nothing. ${scope}`,
    operationId: 'cancelOnboardingRun',
    outputName: 'OnboardingRunResponse',
    responses: { '200': 'The run.', '404': 'No run with that ID exists in the workspace.' },
    tag: 'Workspace',
  }),
  method: 'POST',
  name: 'onboarding-runs.cancel',
  output: z.object({
    run: mirrors<Awaited<ReturnType<typeof cancelOnboardingRun>>>()(onboardingRunSchema),
  }),
  params: runParamsSchema,
  path: '/api/v1/onboarding-runs/{runId}/cancel',
  summary: 'Cancel an onboarding run',
})

/** `POST /api/v1/onboarding-runs/{runId}/rerun`. */
export const rerunOnboardingRunContract = defineContract({
  docs: workspaceDocs({
    description: `Starts a new run for a run's URL. Pages read within the hour are reused and unchanged pages skip the model, so re-running an unchanged site costs nothing. Accepts \`Idempotency-Key\`. ${scope}`,
    operationId: 'rerunOnboardingRun',
    responses: {
      '200': 'An existing run.',
      '201': 'Run started.',
      '404': 'No run with that ID exists in the workspace.',
      '429': 'The workspace started three runs this hour.',
    },
    tag: 'Workspace',
  }),
  headers: idempotencyHeadersSchema,
  method: 'POST',
  name: 'onboarding-runs.rerun',
  output: mirrors<Awaited<ReturnType<typeof startOnboardingRun>>>()(onboardingStartSchema),
  params: runParamsSchema,
  path: '/api/v1/onboarding-runs/{runId}/rerun',
  status: 201,
  summary: 'Re-run onboarding',
})

/** One enrichment finding for a run's site. */
export const onboardingEnrichmentSchema = z.object({
  confidence: z.number(),
  costMicros: z.number().int(),
  domain: z.string(),
  expiresAt: timestampSchema,
  fetchedAt: timestampSchema,
  field: z.string(),
  id: z.string(),
  provider: z.string(),
  sourceUrl: z.string().optional(),
  value: z.unknown(),
})

/** `GET /api/v1/onboarding-runs/{runId}/enrichment`. */
export const listOnboardingEnrichmentContract = defineContract({
  docs: workspaceDocs({
    description: `Lists what enrichment found for the run's site: brand assets, firmographics, social reach, app store listings, competitors, and mentions, each with its provider, confidence, source, and cost. ${scope}`,
    operationId: 'listOnboardingEnrichment',
    outputName: 'OnboardingEnrichmentResponse',
    responses: { '200': 'The findings.', '404': 'No run with that ID exists in the workspace.' },
    tag: 'Workspace',
  }),
  method: 'GET',
  name: 'onboarding-runs.enrichment',
  output: z.object({
    enrichment: mirrors<Awaited<ReturnType<typeof listOnboardingEnrichment>>>()(
      z.array(onboardingEnrichmentSchema)
    ),
  }),
  params: runParamsSchema,
  path: '/api/v1/onboarding-runs/{runId}/enrichment',
  summary: 'List onboarding enrichment',
})

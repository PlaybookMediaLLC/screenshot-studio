import { z } from 'zod'

/** Independent GitHub event families; selecting one does not correlate events. */
export const automationFamilySchema = z.enum([
  'release.published',
  'pull_request.merged',
  'deployment.succeeded',
])

/** A bounded predicate or nested group; semantic validation belongs to Go. */
export const automationConditionSchema = z.object({
  group: z.enum(['ALL', 'ANY', 'NOT']).optional(),
  get children() {
    return z.array(automationConditionSchema).max(32).optional()
  },
  field: z.string().max(100).optional(),
  operator: z.string().max(40).optional(),
  values: z.array(z.string().max(1000)).max(50).optional(),
})

/** Registered draft/review actions. Approval and publishing are not actions. */
export const automationActionSchema = z.object({
  type: z.enum(['create_release', 'create_campaign', 'submit_review']),
  input: z.object({ nodeId: z.string().max(64), output: z.string().max(64) }).optional(),
  brandKitId: z.string().max(64).optional(),
  destinationIds: z.array(z.string().max(64)).max(10).optional(),
  audience: z.string().max(1000).optional(),
  callToAction: z.string().max(300).optional(),
})

/** Draft nodes may be incomplete; server activation requires valid configuration. */
export const automationNodeSchema = z.object({
  id: z.string().max(64),
  type: z.enum(['trigger', 'condition', 'action', 'end']),
  condition: automationConditionSchema.optional(),
  action: automationActionSchema.optional(),
  outcome: z.string().max(40).optional(),
})

/** Execution semantics exclude node positions. */
export const automationGraphSchema = z.object({
  schemaVersion: z.number().int(),
  family: automationFamilySchema,
  qualification: automationConditionSchema,
  nodes: z.array(automationNodeSchema).max(64),
  edges: z
    .array(
      z.object({ from: z.string().max(64), to: z.string().max(64), branch: z.string().max(20) })
    )
    .max(128),
})

/** Canvas positions are saved separately and never interpreted by the worker. */
export const automationLayoutSchema = z.record(
  z.string().max(64),
  z.object({
    x: z.number().min(-100000).max(100000),
    y: z.number().min(-100000).max(100000),
  })
)

/** Validation errors link to a node, or the definition when nodeId is empty. */
export const automationIssueSchema = z.object({
  nodeId: z.string(),
  code: z.string(),
  message: z.string(),
})

/** One definition with its editable draft and immutable active-version reference. */
export const automationDefinitionSchema = z.object({
  id: z.string(),
  sourceAppId: z.string(),
  name: z.string(),
  description: z.string(),
  priority: z.number(),
  revision: z.number(),
  enabled: z.boolean(),
  activeVersionId: z.string().nullable(),
  activePriority: z.number(),
  draft: automationGraphSchema,
  layout: automationLayoutSchema,
  modifiedBy: z.string(),
  updatedAt: z.string(),
  issues: z.array(automationIssueSchema),
})

/** Optimistic concurrency prevents a stale tab from replacing another admin's draft. */
export const automationSaveSchema = z.object({
  id: z.string().max(64).default(''),
  sourceAppId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000),
  priority: z.number().int().min(0).max(9999),
  expectedRevision: z.number().int().nonnegative(),
  graph: automationGraphSchema,
  layout: automationLayoutSchema,
})

/** Evidence state distinguishes absent metadata from unfinished/failed enrichment. */
export const automationValueSchema = z.object({
  state: z.string(),
  values: z.array(z.string()).optional(),
  boolean: z.boolean().optional(),
})

/** Normalized evidence; raw GitHub payloads and credentials are never retained. */
export const automationEventSchema = z.object({
  family: automationFamilySchema,
  semanticKey: z.string().max(255),
  repositoryId: z.string().min(1).max(64),
  repositoryName: z.string().max(200),
  objectId: z.string().max(64),
  number: z.number().int().positive().optional(),
  occurredAt: z.string().datetime(),
  origin: z.string(),
  title: z
    .string()
    .min(1)
    .refine((value) => [...value].length <= 160),
  notes: z.string().refine((value) => [...value].length <= 50000),
  url: z.string().max(2000),
  defaultBranch: z.string().max(200).optional(),
  fields: z.record(z.string(), automationValueSchema),
})

/** Pure preview against exactly one supplied example or tenant-owned stored event. */
export const automationPreviewInputSchema = z
  .object({
    sourceAppId: z.string().min(1).max(64),
    graph: automationGraphSchema,
    eventId: z.string().min(1).max(64).optional(),
    example: automationEventSchema.optional(),
  })
  .refine(
    (value) => Boolean(value.eventId) !== Boolean(value.example),
    'Choose an example or recorded event.'
  )

/** A condition's explicit result; unresolved evidence never chooses an else branch. */
export const automationDecisionSchema = z.object({
  status: z.string(),
  match: z.boolean(),
  reason: z.string(),
})

/** A prediction lists actions without fabricating IDs or invoking their side effects. */
export const automationPreviewSchema = z.object({
  issues: z.array(automationIssueSchema),
  qualification: automationDecisionSchema,
  steps: z.array(
    z.object({
      nodeId: z.string(),
      type: z.string(),
      decision: automationDecisionSchema.optional(),
      action: z.string().optional(),
      outcome: z.string().optional(),
    })
  ),
  outcome: z.string(),
  evidence: z.string(),
})

/** Safe workspace resources and the live worker capability reported by the backend. */
export const automationOverviewSchema = z.object({
  definitions: z.array(automationDefinitionSchema),
  sources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      repositoryId: z.string(),
      status: z.string(),
      mode: z.string(),
      account: z.string(),
      installationStatus: z.string(),
      connectionState: z.string(),
      collectUnmatched: z.boolean(),
    })
  ),
  brands: z.array(z.object({ id: z.string(), name: z.string() })),
  destinations: z.array(z.object({ id: z.string(), name: z.string() })),
  fields: z.record(automationFamilySchema, z.record(z.string(), z.string())),
  executorAvailable: z.boolean(),
})

/** Product references produced by completed actions. */
export const automationOutputsSchema = z.object({
  releaseId: z.string().optional(),
  campaignId: z.string().optional(),
  postIds: z.array(z.string()).optional(),
  brandKitId: z.string().optional(),
  brandKitVersion: z.number().int().optional(),
  destinationIds: z.array(z.string()).optional(),
})

/** Persisted event/run history remains readable during a Temporal outage. */
export const automationHistoryItemSchema = z.object({
  event: z.object({
    id: z.string(),
    sourceAppId: z.string(),
    deliveryId: z.string(),
    snapshot: automationEventSchema,
    versionIds: z.array(z.string()),
    mode: z.string(),
    disposition: z.string(),
    reason: z.string(),
    receivedAt: z.string(),
    enrichedAt: z.string().nullable(),
    enrichment: z.record(z.string(), automationValueSchema),
  }),
  run: z.object({
    id: z.string(),
    eventId: z.string(),
    definitionId: z.string().nullable(),
    versionId: z.string().nullable(),
    workflowId: z.string(),
    temporalRunId: z.string(),
    status: z.string(),
    cancelRequested: z.boolean(),
    recoveryAttempt: z.number(),
    failureCode: z.string(),
    reason: z.string(),
    outputs: automationOutputsSchema,
    createdAt: z.string(),
    completedAt: z.string().nullable(),
  }),
})

/** Node-level decisions, receipts, and attempts for one tenant run. */
export const automationRunDetailSchema = automationHistoryItemSchema.extend({
  nodes: z.array(
    z.object({
      nodeId: z.string(),
      actionKey: z.string(),
      status: z.string(),
      attempts: z.number(),
      failureCode: z.string(),
      decision: automationDecisionSchema,
      outputs: automationOutputsSchema,
      startedAt: z.string(),
      completedAt: z.string().nullable(),
    })
  ),
})

/** Identity input for tenant-owned records. */
export const automationIdentitySchema = z.object({ id: z.string().min(1).max(64) })

/** A version transition must use the last saved revision. */
export const automationRevisionSchema = automationIdentitySchema.extend({
  revision: z.number().int().positive(),
})

/** The condition type inferred from its transport contract. */
export type AutomationCondition = z.infer<typeof automationConditionSchema>
/** The graph type inferred from its transport contract. */
export type AutomationGraph = z.infer<typeof automationGraphSchema>

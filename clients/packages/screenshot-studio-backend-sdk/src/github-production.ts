import { z } from 'zod'

/** Provider workflow identity, independent from the Shots workflow graph. */
export const githubWorkflowSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  path: z.string(),
  state: z.string(),
})
const strings = z
  .array(z.string().max(255))
  .nullable()
  .transform((v) => v ?? [])
/** Immutable repository production policy; version zero is migration-only. */
export const githubProductionPolicySchema = z
  .object({
    schemaVersion: z.number().int().min(0).max(1),
    enabled: z.boolean(),
    installationId: z.number().int().nonnegative(),
    repositoryId: z.string().max(64),
    environments: strings,
    refs: strings,
    signal: z.string(),
    workflows: z
      .array(githubWorkflowSchema)
      .max(20)
      .nullable()
      .transform((v) => v ?? []),
    jobNames: strings,
    trustedAppIds: z
      .array(z.number().int().positive())
      .max(20)
      .nullable()
      .transform((v) => v ?? []),
    requireChangeReceipt: z.boolean(),
    trustActionsOutcome: z.boolean(),
    definitionId: z.string().max(100),
  })
  .strict()
/** Safe normalized provider observation, with missing evidence preserved. */
export const githubEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventName: z.enum(['deployment_status', 'workflow_run', 'workflow_job']),
    action: z.string().max(255),
    key: z.string().max(255),
    objectKey: z.string().max(255),
    objectId: z.string().max(64),
    observationId: z.string().max(64),
    installationId: z.number().int().positive(),
    repositoryId: z.string().max(64),
    repositoryName: z.string().max(255),
    defaultBranch: z.string().max(255).optional(),
    actorLogin: z.string().max(255).optional(),
    occurredAt: z.string(),
    state: z.string().max(255),
    environment: z.string().max(255),
    deploymentEnvironment: z.string().max(255),
    production: z.boolean().nullable(),
    ref: z.string().max(255),
    sha: z.string().max(255),
    url: z.string().max(2000),
    appId: z.number().int(),
    workflow: githubWorkflowSchema,
    runId: z.number().int(),
    runAttempt: z.number().int(),
    jobId: z.number().int(),
    jobName: z.string().max(255),
    association: z.string().max(100),
    conflict: z.boolean(),
    changeReceipt: z.boolean().nullable(),
    receiptRevision: z.string().max(255),
    receiptAppId: z.number().int(),
  })
  .strict()
/** Three-valued production decision; each condition explains its result. */
export const githubProductionDecisionSchema = z.object({
  status: z.string(),
  reason: z.string(),
  strength: z.string(),
  checks: z
    .array(z.object({ condition: z.string(), status: z.string(), reason: z.string() }))
    .nullable()
    .transform((v) => v ?? []),
})
/** An immutable policy revision. */
export const githubPolicyVersionSchema = z.object({
  id: z.string(),
  revision: z.number().int(),
  policy: githubProductionPolicySchema,
  createdAt: z.string(),
})
/** Receipt, observation, pinned versions and resulting event stay distinct. */
export const githubObservationSchema = z.object({
  id: z.string(),
  deliveryId: z.string(),
  evidence: githubEvidenceSchema,
  policyId: z.string().nullable(),
  workflowVersionId: z.string().nullable(),
  eventId: z.string().nullable(),
  status: z.string(),
  origin: z.string(),
  decision: githubProductionDecisionSchema,
  duplicates: z.number().int(),
  receivedAt: z.string(),
  processedAt: z.string().nullable(),
  runId: z.string().nullable(),
  dispatchStatus: z.string(),
})
/** Tenant-scoped production history. */
export const githubProductionStateSchema = z.object({
  policies: z.array(githubPolicyVersionSchema),
  observations: z.array(githubObservationSchema),
  nextCursor: z.string(),
})
/** Available GitHub reads and provider selection. */
export const githubProductionCatalogSchema = z.object({
  access: z.string(),
  reason: z.string(),
  installationId: z.number().int(),
  repositoryId: z.string(),
  capabilities: z
    .object({
      actions: z.boolean(),
      deployments: z.boolean(),
      events: z.array(z.string()),
      subscriptionsKnown: z.boolean(),
    })
    .nullable(),
  workflows: z
    .array(githubWorkflowSchema)
    .nullable()
    .transform((v) => v ?? []),
  jobs: z
    .array(
      z.object({
        id: z.number().int(),
        runId: z.number().int(),
        runAttempt: z.number().int(),
        name: z.string(),
        status: z.string(),
        conclusion: z.string(),
      })
    )
    .nullable()
    .transform((v) => v ?? []),
})
/** Provider recovery status never asserts complete event history. */
export const githubRecoverySchema = z.object({
  status: z.string(),
  reason: z.string(),
  gap: z.boolean(),
  hasMore: z.boolean(),
  windowStart: z.string().nullable(),
  lastCompleteAt: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
  deliveries: z.array(
    z.object({
      id: z.string(),
      guid: z.string(),
      eventName: z.string(),
      status: z.string(),
      attempts: z.number().int(),
      deliveredAt: z.string(),
      nextAttemptAt: z.string().nullable(),
    })
  ),
})
/** Policy input with optimistic concurrency. */
export const saveGitHubProductionSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    policy: githubProductionPolicySchema.refine(
      (p) =>
        p.schemaVersion === 1 &&
        p.environments.length > 0 &&
        p.environments.length <= 20 &&
        p.refs.length <= 50 &&
        p.jobNames.length <= 20 &&
        p.definitionId.length > 0,
      'A version 1 policy, production environment, and Shots workflow are required.'
    ),
  })
  .strict()
/** Read-only preview from stored evidence or an explicitly supplied example. */
export const previewGitHubProductionSchema = z
  .object({
    policy: githubProductionPolicySchema,
    observationId: z.string().max(64).optional(),
    example: githubEvidenceSchema.optional(),
  })
  .strict()
/** Versioned policy type. */
export type GitHubProductionPolicy = z.infer<typeof githubProductionPolicySchema>
/** Normalized evidence type. */
export type GitHubEvidence = z.infer<typeof githubEvidenceSchema>

/** Qualification metadata belongs to a workspace decision, not a provider flag. */
export const productionQualificationSchema = z.object({
  observationId: z.string(),
  policyId: z.string(),
  policyRevision: z.number().int(),
  strength: z.string(),
})

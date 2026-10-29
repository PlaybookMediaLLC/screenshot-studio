import { z } from 'zod'

/** Hosting providers whose deployment evidence is supported. */
export const frontendProviderSchema = z.enum([
  'github',
  'vercel',
  'netlify',
  'cloudflare_pages',
  'cloudflare_workers',
])
/** An explicitly selected check, including its provenance and correlation scope. */
export const frontendCheckRuleSchema = z
  .object({
    source: z.enum(['github_check', 'github_status', 'vercel_check']),
    name: z.string().min(1).max(200),
    appId: z.string().max(100),
    scope: z.enum(['commit', 'deployment']),
    passing: z
      .array(z.enum(['success', 'neutral']))
      .min(1)
      .max(2),
    maxAgeSeconds: z.number().int().min(60).max(604800),
  })
  .strict()
/** Versioned, opt-in production and required-check rules. */
export const frontendPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    environments: z.array(z.string().min(1).max(255)).min(1).max(10),
    branch: z.string().max(255),
    tag: z.string().max(255),
    domain: z.string().max(255),
    workflowId: z.string().max(255),
    job: z.string().max(255),
    checks: z.array(frontendCheckRuleSchema).max(20),
    alerts: z.array(z.enum(['matched', 'failed', 'needs_attention', 'rollback'])).max(4),
    workflowVersionId: z.string().max(255),
  })
  .strict()
/** A provider-reported check; results belong to a precise revision or deployment. */
export const frontendCheckSchema = z.object({
  source: z.string(),
  id: z.string(),
  name: z.string(),
  appId: z.string(),
  repositoryId: z.string(),
  revision: z.string(),
  deploymentId: z.string(),
  status: z.string(),
  conclusion: z.string(),
  occurredAt: z.string(),
})
/** Bounded provider evidence, never raw webhook metadata or credentials. */
export const frontendObservationSchema = z.object({
  provider: z.string(),
  accountId: z.string(),
  projectId: z.string(),
  key: z.string(),
  providerEventId: z.string(),
  kind: z.string(),
  deploymentId: z.string(),
  activationId: z.string(),
  activationKey: z.string(),
  environment: z.string(),
  branch: z.string(),
  tag: z.string(),
  revision: z.string(),
  repositoryId: z.string(),
  repositoryName: z.string().default(''),
  runId: z.string(),
  runAttempt: z.number().int(),
  workflowId: z.string(),
  jobId: z.string(),
  job: z.string(),
  workflowLinked: z.boolean(),
  url: z.string(),
  status: z.string(),
  build: z.string(),
  production: z.string(),
  rollback: z.boolean(),
  occurredAt: z.string(),
  activationObservedAt: z.string().nullable(),
  checks: z.array(frontendCheckSchema).nullable(),
  evidence: z.array(z.string()).nullable(),
})
/** A decision states what is supported; deployment evidence never approves release readiness. */
export const frontendDecisionSchema = z.object({
  state: z.enum(['matched', 'not_matched', 'pending', 'needs_attention', 'failed']),
  reason: z.string(),
  checks: z.string(),
  verifiedLive: z.boolean(),
  releaseReady: z.boolean(),
})
/** Administrative input; omitted credentials retain the backend-owned encrypted values. */
export const frontendSourceInputSchema = z
  .object({
    githubSourceId: z.string().max(100).default(''),
    id: z.string().max(100),
    name: z.string().min(1).max(160),
    revision: z.number().int().nonnegative(),
    provider: frontendProviderSchema,
    accountId: z.string().min(1).max(100),
    projectId: z.string().min(1).max(200),
    token: z.string().max(8000),
    secret: z.string().max(8000),
    enabled: z.boolean(),
    policy: frontendPolicySchema,
  })
  .strict()
/** Safe connection settings and recovery health. */
export const frontendSourceSchema = frontendSourceInputSchema
  .omit({ token: true, secret: true })
  .extend({
    hasToken: z.boolean(),
    hasSecret: z.boolean(),
    baselineAt: z.string(),
    effectiveAt: z.string(),
    lastPollAt: z.string().nullable(),
    health: z.string(),
  })
/** An immutable receipt with the policy and decision used at processing time. */
export const frontendEvidenceSchema = z.object({
  current: z
    .object({
      observation: frontendObservationSchema,
      decision: frontendDecisionSchema,
      updatedAt: z.string(),
    })
    .nullable(),
  id: z.string(),
  sourceId: z.string(),
  policyVersion: z.number().int(),
  policy: frontendPolicySchema,
  observation: frontendObservationSchema,
  decision: frontendDecisionSchema,
  historical: z.boolean(),
  receivedAt: z.string(),
  processedAt: z.string(),
})
/** Side-effect-free policy preview. */
export const frontendPreviewSchema = z
  .object({ policy: frontendPolicySchema, observation: frontendObservationSchema })
  .strict()
/** Source input validated by the shared runtime contract. */
export type FrontendSourceInput = z.infer<typeof frontendSourceInputSchema>
/** Safe source settings. */
export type FrontendSource = z.infer<typeof frontendSourceSchema>
/** Production policy. */
export type FrontendPolicy = z.infer<typeof frontendPolicySchema>
/** Normalized observation used by preview and evidence history. */
export type FrontendObservation = z.infer<typeof frontendObservationSchema>

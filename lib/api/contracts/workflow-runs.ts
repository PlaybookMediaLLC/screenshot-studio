import { z } from 'zod'
import {
  automationFamilySchema,
  automationGraphSchema,
  automationEventSchema,
  automationHistoryItemSchema,
} from './release-automation'

/** Persisted run states; review and publishing state belong to the campaign. */
export const automationRunStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'skipped',
  'failed',
  'needs_attention',
  'cancelled',
])

/** Optional run-history filters; tenant scope always comes from the session. */
export const automationHistoryFilterSchema = z.strictObject({
  before: z.string().max(64).optional(),
  definitionId: z.string().max(64).optional(),
  versionId: z.string().max(64).optional(),
  sourceAppId: z.string().max(64).optional(),
  family: automationFamilySchema.optional(),
  status: automationRunStatusSchema.optional(),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
})

/** An immutable activated revision of a definition. */
export const automationVersionSchema = z.object({
  id: z.string(),
  definitionId: z.string(),
  revision: z.number().int(),
  graph: automationGraphSchema,
  contentHash: z.string(),
  activatedBy: z.string().optional(),
  createdAt: z.string().optional(),
})

/** Source mode, unmatched-PR policy, and watched branch for one repository. */
export const automationSourceModeSchema = z.strictObject({
  id: z.string().min(1).max(64),
  enabled: z.boolean(),
  collectUnmatched: z.boolean().optional(),
  branch: z
    .string()
    .max(255)
    .regex(/^(?!-)(?!.*\.\.)[^\s~^:?*[\\]*$/, 'Use a valid Git branch name.')
    .optional(),
})

/** A persisted run state. */
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>
/** Run-history filters. */
export type AutomationHistoryFilter = z.infer<typeof automationHistoryFilterSchema>
/** An immutable activated version. */
export type AutomationVersion = z.infer<typeof automationVersionSchema>

/** List evidence excludes release notes, enrichment, and unrelated GitHub fields. */
export const automationRunSummarySchema = automationHistoryItemSchema.extend({
  event: automationHistoryItemSchema.shape.event
    .pick({ id: true, sourceAppId: true, receivedAt: true })
    .extend({
      snapshot: automationEventSchema.pick({
        family: true,
        repositoryName: true,
        objectId: true,
        number: true,
        title: true,
        fields: true,
      }),
    }),
})

/** A lightweight run for overview and history lists. */
export type AutomationRunSummary = z.infer<typeof automationRunSummarySchema>

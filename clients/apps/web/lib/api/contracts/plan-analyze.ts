import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'
import { contentDraftIdSchema, contentDraftSchema, contentDraftPostSchema } from './content-drafts'
import { workspaceDocs } from './workspace-docs'

/** An exact calendar revision; an immutable scheduled post ID is its publication revision. */
export const calendarPlacementSchema = z.strictObject({
  draftId: contentDraftIdSchema,
  version: z.number().int().positive(),
  calendarVersion: z.number().int().positive(),
  postId: contentDraftIdSchema.optional(),
  at: z.iso.datetime({ offset: true }).nullable(),
  timeZone: z.string().max(80),
})
/** A retry-safe calendar command. Undo submits the returned inverse with a fresh key. */
export const calendarCommandSchema = z.strictObject({
  key: contentDraftIdSchema,
  action: z.enum(['move', 'swap', 'unschedule', 'remove_date']),
  items: z.array(calendarPlacementSchema).min(1).max(2),
})
/** A committed result, independent of workflow wakeup availability. */
export const calendarResultSchema = z.object({
  drafts: z.array(contentDraftSchema),
  posts: z.array(contentDraftPostSchema),
  undo: z.array(calendarPlacementSchema),
})
/** One account and an inclusive local date range. */
export const analyticsQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    timeZone: z.string().max(80).default('UTC'),
    grouping: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
    scope: z.enum(['all', 'replies']).default('all'),
    sort: z
      .enum([
        'latest',
        'impressions',
        'likes',
        'replies',
        'reposts',
        'bookmarks',
        'engagementRate',
        'engagements',
        'quotes',
        'profileClicks',
        'linkClicks',
      ])
      .default('latest'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    cursor: z.string().max(64).default(''),
    limit: z.coerce.number().int().min(1).max(10000).default(25),
    asOf: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((q) => q.from <= q.to, 'From must be before or equal to To.')
/** Availability is separate from numeric values; zero is always valid data. */
export const metricStateSchema = z.enum([
  'available',
  'insufficient',
  'unsupported',
  'forbidden',
  'failed',
  'stale',
])
/** One real observation or aggregate with an explicit sample count. */
export const analyticsPointSchema = z.object({
  at: z.string(),
  value: z.number().finite().nullable(),
  samples: z.number().int().nonnegative(),
})
/** A metric can fail independently of its neighboring cards. */
export const analyticsMetricSchema = z.object({
  status: metricStateSchema,
  value: z.number().finite().nullable(),
  previous: z.number().finite().nullable(),
  change: z.number().finite().nullable(),
  points: z.array(analyticsPointSchema),
  definition: z.string(),
  samples: z.number().int(),
  missing: z.number().int(),
})
/** A single provider post, never an implicit thread aggregate. */
export const analyticsRowSchema = z.object({
  id: z.string(),
  remoteId: z.string(),
  excerpt: z.string(),
  url: z.string(),
  publishedAt: z.iso.datetime({ offset: true }),
  observedAt: z.iso.datetime({ offset: true }).nullable(),
  status: z.string(),
  threadRootId: z.string().nullable(),
  threadPosition: z.number().int(),
  isReply: z.boolean(),
  metrics: z.record(z.string(), z.number().finite()),
})
/** Goals count one confirmed root publication per eligible day or week, from save onward. */
export const postingGoalSchema = z.object({
  cadence: z.enum(['daily', 'weekly']),
  excludeWeekends: z.boolean(),
  timeZone: z.string(),
  effectiveDate: z.string(),
})
/** Sharing and goals change only through an explicit, versioned save. */
export const analyticsSettingsSchema = z.object({
  version: z.number().int(),
  goal: postingGoalSchema.nullable(),
  publicToken: z.string().nullable(),
})
/** A validated account-scoped report consumed by cards, charts, tables and exports. */
export const analyticsReportSchema = z.object({
  accountId: z.string(),
  name: z.string(),
  platform: z.string(),
  profileUrl: z.string(),
  query: analyticsQuerySchema,
  status: metricStateSchema,
  capabilities: z.object({ account: z.boolean(), posts: z.boolean(), import: z.boolean() }),
  checkedAt: z.iso.datetime({ offset: true }).nullable(),
  coverageStart: z.iso.datetime({ offset: true }).nullable(),
  asOf: z.iso.datetime({ offset: true }),
  metrics: z.record(z.string(), analyticsMetricSchema),
  posts: z.array(analyticsRowSchema),
  totalPosts: z.number().int(),
  nextCursor: z.string().nullable(),
  hourly: z.array(
    z.object({
      day: z.number().int(),
      hour: z.number().int(),
      samples: z.number().int(),
      total: z.number(),
      average: z.number().nullable(),
      postIds: z.array(z.string()),
    })
  ),
  settings: analyticsSettingsSchema,
  progress: z.object({
    streak: z.number().int(),
    current: z.number().int(),
    required: z.number().int(),
    period: z.string(),
  }),
})
/** Versioned settings command; exporting an image never calls this operation. */
export const analyticsSettingsInputSchema = z.strictObject({
  version: z.number().int().positive(),
  action: z.enum(['goal', 'enable', 'revoke']),
  goal: postingGoalSchema.optional(),
})

const entitlement = { 'x-shots-entitlement': { feature: 'content:drafts', minimumPlan: 'pro' } }
const params = z.object({ id: contentDraftIdSchema })
/** Apply a placement change with publication permissions rechecked in Go. */
export const mutateCalendarContract = defineContract({
  access: { permission: 'artifact:read', feature: 'content:drafts' },
  method: 'POST',
  name: 'calendar.mutate',
  path: '/api/v1/calendar/mutations',
  body: calendarCommandSchema,
  output: calendarResultSchema,
  summary: 'Move, swap, unschedule or clear a calendar placement',
  docs: workspaceDocs({
    operationId: 'mutateCalendar',
    outputName: 'CalendarResult',
    description:
      'Conditional calendar mutation. Scheduled changes also require publish:manage. Retries replay the committed result.',
    extensions: entitlement,
    responses: { '200': 'Committed result.', '409': 'Stale placement or publishing has started.' },
    tag: 'Workspace',
  }),
})
/** Read analytics through the existing backend authority. */
export const getAnalyticsContract = defineContract({
  access: { permission: 'artifact:read', apiKeyScope: 'artifact:read', feature: 'content:drafts' },
  method: 'GET',
  name: 'analytics.get',
  path: '/api/v1/analytics/{id}',
  params,
  query: analyticsQuerySchema,
  output: analyticsReportSchema,
  summary: 'Read account analytics',
  docs: workspaceDocs({
    operationId: 'getAccountAnalytics',
    outputName: 'AnalyticsReport',
    description: 'One account/date snapshot with explicit metric availability and freshness.',
    extensions: entitlement,
    responses: { '200': 'Report.' },
    tag: 'Workspace',
  }),
})
/** A bounded manual refresh consumes provider quota but never publishes. */
export const refreshAnalyticsContract = defineContract({
  access: { permission: 'publish:manage', feature: 'content:drafts' },
  method: 'POST',
  name: 'analytics.refresh',
  path: '/api/v1/analytics/{id}/refresh',
  params,
  output: z.object({ refreshed: z.boolean() }),
  summary: 'Refresh account analytics',
  docs: workspaceDocs({
    operationId: 'refreshAccountAnalytics',
    outputName: 'AnalyticsRefresh',
    description:
      'Authenticated publisher requests a bounded provider refresh. Collection state and existing observations survive failure; no publication is created.',
    extensions: entitlement,
    responses: {
      '200': 'Refresh completed.',
      '409': 'Refresh is in progress or was requested too recently.',
    },
    tag: 'Workspace',
  }),
})
/** Persist a goal or an explicit enable/revoke operation. */
export const updateAnalyticsSettingsContract = defineContract({
  access: { permission: 'publish:manage', feature: 'content:drafts' },
  method: 'PUT',
  name: 'analytics.settings',
  path: '/api/v1/analytics/{id}/settings',
  params,
  body: analyticsSettingsInputSchema,
  output: analyticsSettingsSchema,
  summary: 'Save analytics sharing or posting goal',
  docs: workspaceDocs({
    operationId: 'updateAnalyticsSettings',
    outputName: 'AnalyticsSettings',
    description:
      'Versioned, audited publisher operation. Public sharing is disabled by default; revoke makes subsequent reads return 404 with no-store.',
    extensions: entitlement,
    responses: { '200': 'Saved settings.', '409': 'Settings changed; reload before retrying.' },
    tag: 'Workspace',
  }),
})
/** Public reads resolve a random token and recheck revocation on every request. */
export const publicAnalyticsContract = defineContract({
  method: 'GET',
  name: 'analytics.public',
  path: '/api/analytics/public/{token}',
  params: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }),
  query: analyticsQuerySchema,
  output: analyticsReportSchema,
  summary: 'Read explicitly shared analytics',
})

/** The report wire type. */
export type AnalyticsReport = z.infer<typeof analyticsReportSchema>
/** The explicit query wire type. */
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>
/** One placement command's wire type. */
export type CalendarPlacement = z.infer<typeof calendarPlacementSchema>

/** Serialized calendar result returned by the Go SDK. */
export type CalendarResultWire = z.output<typeof calendarResultSchema>

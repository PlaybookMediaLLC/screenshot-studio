import { z } from 'zod'
import { defineContract, timestampSchema } from '@/lib/api/contract'
import { scheduledPostStatusSchema } from '@/lib/api/contracts/scheduled-posts'
import { workspaceDocs } from '@/lib/api/contracts/workspace-docs'
import { automationSchema, draftKindSchema } from '@/lib/write/document'
import {
  contentDraftSortSchema,
  contentDraftViewSchema,
  draftEngagementSchema,
  draftWriteFieldsSchema,
  draftWriteInputSchema,
  pollSchema,
  postAutomationSchema,
  scheduleTimingSchema,
} from '@/lib/write/wire'

/** Where a draft is in its life. Scheduling sets `scheduled`. */
export const contentDraftStatusSchema = z.enum(['draft', 'scheduled', 'archived'])

/** Statuses a client may set by hand. */
export const contentDraftEditableStatusSchema = z.enum(['draft', 'archived'])

/** A workspace resource id: a cuid or a UUID. */
export const contentDraftIdSchema = z
  .string()
  .regex(/^(?:[a-z0-9]{10,32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/)

/** Plate JSON: the editor's value, a list of block nodes. */
export const plateValueSchema = z.array(z.record(z.string(), z.unknown())).max(5_000)

/** A platform a draft posts to. */
const platformSchema = z.enum(['x', 'linkedin', 'instagram', 'threads', 'bluesky', 'mastodon'])

/** A draft as the API returns it. */
export const contentDraftSchema = z
  .object({
    assetIds: z.array(z.string()),
    body: plateValueSchema,
    channelConnectionIds: z.array(z.string()),
    createdAt: timestampSchema,
    createdByUserId: z.string().nullable(),
    /** Text a channel posts instead of the body's, by channel. */
    channelText: z.record(z.string(), z.string()),
    discussions: z.record(z.string(), z.unknown()),
    id: z.string(),
    organizationId: z.string(),
    plainText: z.string(),
    status: contentDraftStatusSchema,
    title: z.string(),
    updatedAt: timestampSchema,
    updatedByUserId: z.string().nullable(),
    version: z.number().int().min(1),
    /** Review before scheduling; approval holds for `approvedVersion` only. */
    approvedVersion: z.number().int().nullable(),
    reviewNote: z.string().nullable(),
    reviewStatus: z.enum(['none', 'pending', 'approved', 'changes_requested']),
    reviewedByUserId: z.string().nullable(),
    /** The read-and-comment link's token, while the link is on. */
    shareToken: z.string().nullable(),
    /** Comments guests left through that link. */
    guestComments: z.array(
      z.object({ createdAt: timestampSchema, name: z.string(), text: z.string() })
    ),
    /** The draft's live posts (lists only). */
    publishedPosts: z.number().int(),
    /**
     * The draft's social set and what it copied from the set's defaults when it
     * was created (RFC 043). Defaults keep an older backend's answer readable.
     */
    engagement: draftEngagementSchema,
    naturalPostingTime: z.boolean().default(false),
    /** A calendar placement without scheduling, as an ISO 8601 instant. */
    plannedFor: timestampSchema.nullable().default(null),
    primaryPlatform: z.string().nullable().default(null),
    socialSetId: z.string().nullable().default(null),
  })
  .extend(draftWriteFieldsSchema.shape)

/** The fields a draft is created or updated with. */
export const contentDraftFieldsSchema = draftWriteInputSchema.extend({
  assetIds: z.array(contentDraftIdSchema).max(20).optional(),
  body: plateValueSchema.optional(),
  channelConnectionIds: z.array(contentDraftIdSchema).max(10).optional(),
  /** Text a channel posts instead of the body's, by channel. */
  channelText: z.partialRecord(platformSchema, z.string().max(100_000)).optional(),
  /** Comment threads on the body and their authors' names. */
  discussions: z.record(z.string(), z.unknown()).optional(),
  plainText: z.string().max(100_000).optional(),
  title: z.string().max(200).optional(),
})

/**
 * A new draft: the fields, plus what only creation sets. Without a social
 * set the draft goes to the workspace's default set; without channels it
 * takes the set's default platforms.
 */
export const contentDraftCreateSchema = contentDraftFieldsSchema.extend({
  kind: draftKindSchema.optional(),
  /** The platform the body is written for; the set's primary platform when omitted. */
  primaryPlatform: platformSchema.optional(),
  scratchpad: z.string().max(20_000).optional(),
  socialSetId: contentDraftIdSchema.optional(),
  /** Tags of the draft's set (an experiment). */
  tagIds: z.array(contentDraftIdSchema).max(20).optional(),
})

/** An update: the fields it sets, based on the version the client last saw. */
export const contentDraftUpdateSchema = contentDraftFieldsSchema.extend({
  baseVersion: z.number().int().min(1),
  status: contentDraftEditableStatusSchema.optional(),
  /** The draft's own choices, which start as copies of its set's defaults. */
  naturalPostingTime: z.boolean().optional(),
  primaryPlatform: z.union([platformSchema, z.literal('')]).optional(),
  /** An ISO 8601 instant, or an empty string to clear it. */
  plannedFor: z.union([z.iso.datetime({ offset: true }), z.literal('')]).optional(),
})

/**
 * The list query. Without `status` or `view`, archived drafts are left out.
 * Pinned drafts come first, in `pinned`, on the first page.
 */
export const contentDraftListQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  kind: draftKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().max(200).optional(),
  socialSetId: contentDraftIdSchema.optional(),
  sort: contentDraftSortSchema.optional(),
  status: contentDraftStatusSchema.optional(),
  tagId: contentDraftIdSchema.optional(),
  view: contentDraftViewSchema.optional(),
})

/** Path parameters naming one draft. */
export const contentDraftParamsSchema = z.object({ id: contentDraftIdSchema })

const entitlement = {
  'x-shots-entitlement': { feature: 'content:drafts', minimumPlan: 'pro' },
}

/** `GET /api/v1/content-drafts` */
export const listContentDraftsContract = defineContract({
  access: { apiKeyScope: 'artifact:read', feature: 'content:drafts', permission: 'artifact:read' },
  docs: workspaceDocs({
    description:
      'Lists the workspace content drafts, newest first. Requires the `artifact:read` scope and the content drafts entitlement (Pro or higher).',
    extensions: entitlement,
    operationId: 'listContentDrafts',
    outputName: 'ContentDraftListResponse',
    responses: { '200': 'Workspace content drafts.', '400': 'The list query is invalid.' },
    tag: 'Workspace',
  }),
  method: 'GET',
  name: 'content-drafts.list',
  output: z.object({
    items: z.array(contentDraftSchema),
    nextCursor: z.string().nullable(),
    pinned: z.array(contentDraftSchema),
  }),
  path: '/api/v1/content-drafts',
  query: contentDraftListQuerySchema,
  summary: 'List content drafts',
})

/** `POST /api/v1/content-drafts` */
export const createContentDraftContract = defineContract({
  access: { apiKeyScope: 'draft:write', feature: 'content:drafts', permission: 'artifact:edit' },
  body: contentDraftCreateSchema,
  docs: workspaceDocs({
    bodyName: 'ContentDraftCreateRequest',
    description:
      'Creates a content draft: a post written in the document editor, kept until it is scheduled. Every attached asset and channel must belong to the workspace. Requires the `draft:write` scope and the content drafts entitlement.',
    extensions: entitlement,
    tag: 'Workspace',
    operationId: 'createContentDraft',
    outputName: 'ContentDraft',
    responses: { '201': 'Draft created.', '400': 'The draft is invalid.' },
  }),
  method: 'POST',
  name: 'content-drafts.create',
  output: contentDraftSchema,
  path: '/api/v1/content-drafts',
  status: 201,
  summary: 'Create a content draft',
})

/** `GET /api/v1/content-drafts/{id}` */
export const getContentDraftContract = defineContract({
  access: { apiKeyScope: 'artifact:read', feature: 'content:drafts', permission: 'artifact:read' },
  docs: workspaceDocs({
    description:
      'Returns one content draft with its Plate JSON body. Requires the `artifact:read` scope and the content drafts entitlement.',
    extensions: entitlement,
    operationId: 'getContentDraft',
    outputName: 'ContentDraft',
    responses: {
      '200': 'The draft.',
      '400': 'The draft identifier is invalid.',
      '404': 'The draft was not found in this workspace.',
    },
    tag: 'Workspace',
  }),
  method: 'GET',
  name: 'content-drafts.get',
  output: contentDraftSchema,
  params: contentDraftParamsSchema,
  path: '/api/v1/content-drafts/{id}',
  summary: 'Get a content draft',
})

/** `PATCH /api/v1/content-drafts/{id}` */
export const updateContentDraftContract = defineContract({
  access: { apiKeyScope: 'draft:write', feature: 'content:drafts', permission: 'artifact:edit' },
  body: contentDraftUpdateSchema,
  docs: workspaceDocs({
    bodyName: 'ContentDraftUpdateRequest',
    description:
      'Updates the fields it sets, based on `baseVersion`. A write based on an older version is refused with 409, so concurrent editors never overwrite each other; reload the draft and retry. Requires the `draft:write` scope.',
    extensions: entitlement,
    tag: 'Workspace',
    operationId: 'updateContentDraft',
    outputName: 'ContentDraft',
    responses: {
      '200': 'Draft updated.',
      '400': 'The update is invalid.',
      '404': 'The draft was not found in this workspace.',
      '409': 'The draft has a newer version than `baseVersion`.',
    },
  }),
  method: 'PATCH',
  name: 'content-drafts.update',
  output: contentDraftSchema,
  params: contentDraftParamsSchema,
  path: '/api/v1/content-drafts/{id}',
  summary: 'Update a content draft',
})

/** `DELETE /api/v1/content-drafts/{id}` */
export const deleteContentDraftContract = defineContract({
  access: { apiKeyScope: 'draft:write', feature: 'content:drafts', permission: 'artifact:edit' },
  docs: workspaceDocs({
    description:
      'Deletes a content draft. Posts already scheduled from it are not changed. Requires the `draft:write` scope.',
    extensions: entitlement,
    tag: 'Workspace',
    operationId: 'deleteContentDraft',
    responses: {
      '200': 'Draft deleted.',
      '400': 'The draft identifier is invalid.',
      '404': 'The draft was not found in this workspace.',
    },
  }),
  method: 'DELETE',
  name: 'content-drafts.delete',
  output: z.object({ deleted: z.literal(true) }),
  params: contentDraftParamsSchema,
  path: '/api/v1/content-drafts/{id}',
  summary: 'Delete a content draft',
})

/** A post scheduled from a draft, with the caption it will publish. */
export const contentDraftPostSchema = z.object({
  caption: z.string(),
  channelConnectionId: z.string(),
  createdAt: timestampSchema,
  id: z.string(),
  platform: z.string(),
  scheduledFor: timestampSchema,
  status: scheduledPostStatusSchema,
  /** Once live: engagement as last read, and the post on its platform. */
  metrics: z.record(z.string(), z.number()).nullable(),
  metricsAt: timestampSchema.nullable(),
  url: z.string().nullable(),
  /** A thread: its reply count and how many went out. */
  replies: z.number().int(),
  threadProgress: z.object({
    lastReplyId: z.string().optional(),
    posted: z.number().int(),
    total: z.number().int(),
  }),
  /** Its follow-ups once live, each with its receipt (RFC 042). */
  automations: z.array(postAutomationSchema).default([]),
  /**
   * How the instant was chosen (RFC 043): queue or explicit, the instant
   * before any natural offset, the offset in seconds, and the time zone.
   */
  naturalOffsetSeconds: z.number().int().nullable().default(null),
  scheduleMode: z.enum(['queue', 'explicit']).nullable().default(null),
  scheduleTimeZone: z.string().nullable().default(null),
  slotAt: timestampSchema.nullable().default(null),
  socialSetId: z.string().nullable().default(null),
})

/**
 * A schedule request. The server serializes the draft for each channel, so
 * the posted captions are the ones the composer previewed.
 */
export const contentDraftScheduleSchema = scheduleTimingSchema.extend({
  /**
   * The draft's table and math blocks rendered as uploaded images, in body
   * order; null for a block posted as text.
   */
  blockImages: z.array(contentDraftIdSchema.nullable()).max(50).optional(),
  channelConnectionIds: z.array(contentDraftIdSchema).min(1).max(10),
  /** Per channel connection: X follow-ups and a poll. */
  options: z
    .record(
      contentDraftIdSchema,
      // X follow-ups: repost and reply at a count, quote later, timed reposts.
      z.object({ autoActions: automationSchema.optional(), poll: pollSchema.optional() })
    )
    .optional(),
  /** The queue's next free slot instead of `scheduledFor`; the backend reserves it. */
  queue: z.boolean().optional(),
  /** Overrides the draft's natural posting time for this schedule (±4 minutes). */
  naturalPostingTime: z.boolean().optional(),
  scheduledFor: z.coerce
    .date()
    .refine((value) => value.getTime() > Date.now(), { message: 'Pick a time in the future.' })
    .optional(),
  version: z.number().int().min(1),
})

/** `GET /api/v1/content-drafts/{id}/posts` */
export const listContentDraftPostsContract = defineContract({
  access: { apiKeyScope: 'artifact:read', feature: 'content:drafts', permission: 'artifact:read' },
  docs: workspaceDocs({
    description:
      'Lists the posts scheduled from a content draft, newest first, with each post status. Requires the `artifact:read` scope.',
    extensions: entitlement,
    operationId: 'listContentDraftPosts',
    outputName: 'ContentDraftPostList',
    responses: {
      '200': 'The draft posts.',
      '400': 'The draft identifier is invalid.',
      '404': 'The draft was not found in this workspace.',
    },
    tag: 'Workspace',
  }),
  method: 'GET',
  name: 'content-drafts.posts',
  output: z.object({ posts: z.array(contentDraftPostSchema) }),
  params: contentDraftParamsSchema,
  path: '/api/v1/content-drafts/{id}/posts',
  summary: 'List the posts scheduled from a content draft',
})

/**
 * `POST /api/v1/content-drafts/{id}/schedule`: one post per channel. A person
 * with `publish:manage` schedules, as for campaign posts, so it takes a
 * session only and is not in the API-key reference.
 */
export const scheduleContentDraftContract = defineContract({
  body: contentDraftScheduleSchema,
  method: 'POST',
  name: 'content-drafts.schedule',
  output: z.object({
    created: z.boolean(),
    draft: contentDraftSchema,
    posts: z.array(contentDraftPostSchema),
  }),
  params: contentDraftParamsSchema,
  path: '/api/v1/content-drafts/{id}/schedule',
  status: 201,
  summary: 'Schedule a content draft to channels',
})

/** A collaboration token: one member, one draft, a few minutes. */
export const collabTokenSchema = z.object({
  access: z.enum(['read', 'write']),
  documentName: z.string(),
  expiresAt: timestampSchema,
  token: z.string(),
})

/**
 * `POST /api/v1/content-drafts/{id}/collab-token`: admits the signed-in member
 * to the draft's real-time session. Browser-only, so it is not in the
 * API-key reference.
 */
export const createCollabTokenContract = defineContract({
  method: 'POST',
  name: 'content-drafts.collab-token',
  output: collabTokenSchema,
  params: contentDraftParamsSchema,
  path: '/api/v1/content-drafts/{id}/collab-token',
  summary: 'Issue a collaboration token for a content draft',
})

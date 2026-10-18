import { z } from 'zod'
import { defineContract, timestampSchema } from '@/lib/api/contract'
import { workspaceDocs } from '@/lib/api/contracts/workspace-docs'

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

/** A draft as the API returns it. */
export const contentDraftSchema = z.object({
  assetIds: z.array(z.string()),
  body: plateValueSchema,
  channelConnectionIds: z.array(z.string()),
  createdAt: timestampSchema,
  createdByUserId: z.string().nullable(),
  id: z.string(),
  organizationId: z.string(),
  plainText: z.string(),
  status: contentDraftStatusSchema,
  title: z.string(),
  updatedAt: timestampSchema,
  updatedByUserId: z.string().nullable(),
  version: z.number().int().min(1),
})

/** The fields a draft is created or updated with. */
export const contentDraftFieldsSchema = z.object({
  assetIds: z.array(contentDraftIdSchema).max(20).optional(),
  body: plateValueSchema.optional(),
  channelConnectionIds: z.array(contentDraftIdSchema).max(10).optional(),
  plainText: z.string().max(100_000).optional(),
  title: z.string().max(200).optional(),
})

/** An update: the fields it sets, based on the version the client last saw. */
export const contentDraftUpdateSchema = contentDraftFieldsSchema.extend({
  baseVersion: z.number().int().min(1),
  status: contentDraftEditableStatusSchema.optional(),
})

/** The list query. Without `status`, archived drafts are left out. */
export const contentDraftListQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: contentDraftStatusSchema.optional(),
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
  output: z.object({ items: z.array(contentDraftSchema), nextCursor: z.string().nullable() }),
  path: '/api/v1/content-drafts',
  query: contentDraftListQuerySchema,
  summary: 'List content drafts',
})

/** `POST /api/v1/content-drafts` */
export const createContentDraftContract = defineContract({
  access: { apiKeyScope: 'draft:write', feature: 'content:drafts', permission: 'artifact:edit' },
  body: contentDraftFieldsSchema,
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

/** Delivery states of a scheduled post. */
export const scheduledPostStatusSchema = z.enum([
  'DRAFT',
  'SCHEDULED',
  'PROCESSING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
  'UNKNOWN_DELIVERY',
])

/** A post scheduled from a draft, with the caption it will publish. */
export const contentDraftPostSchema = z.object({
  caption: z.string(),
  channelConnectionId: z.string(),
  createdAt: timestampSchema,
  id: z.string(),
  platform: z.string(),
  scheduledFor: timestampSchema,
  status: scheduledPostStatusSchema,
})

/**
 * A schedule request. The server serializes the draft for each channel, so
 * the posted captions are the ones the composer previewed.
 */
export const contentDraftScheduleSchema = z.object({
  channelConnectionIds: z.array(contentDraftIdSchema).min(1).max(10),
  scheduledFor: z.coerce.date().refine((value) => value.getTime() > Date.now(), {
    message: 'Pick a time in the future.',
  }),
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

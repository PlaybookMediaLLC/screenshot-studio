import { z } from 'zod'
import { defineContract, timestampSchema } from '@/lib/api/contract'
import { contentDraftIdSchema } from '@/lib/api/contracts/content-drafts'
import { socialSetParamsSchema } from '@/lib/api/contracts/social-sets'
import { workspaceDocs } from '@/lib/api/contracts/workspace-docs'

/**
 * A social set's tags and thread finishers (RFC 025). Tags take an API key
 * with the drafts scopes; finishers are managed by signed-in members.
 */

const entitlement = {
  'x-shots-entitlement': { feature: 'content:drafts', minimumPlan: 'free' },
}
/** A tag's colour. */
export const tagColorSchema = z.enum([
  'gray',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'sky',
  'blue',
  'violet',
  'pink',
])

/** One of {@link tagColorSchema}. */
export type TagColor = z.infer<typeof tagColorSchema>

/** A set's tag. */
export const draftTagSchema = z.object({
  color: tagColorSchema,
  createdAt: timestampSchema,
  id: z.string(),
  name: z.string(),
  socialSetId: z.string(),
})

/** One of {@link draftTagSchema}. */
export type DraftTag = z.infer<typeof draftTagSchema>

/** A tag's name and colour. */
export const draftTagInputSchema = z.strictObject({
  color: tagColorSchema.optional(),
  name: z.string().trim().min(1).max(40).optional(),
})

/** Path parameters naming one of a set's tags. */
export const draftTagParamsSchema = socialSetParamsSchema.extend({ tagId: contentDraftIdSchema })

/** `GET /api/v1/social-sets/{id}/tags` */
export const listDraftTagsContract = defineContract({
  access: { apiKeyScope: 'artifact:read', feature: 'content:drafts', permission: 'artifact:read' },
  docs: workspaceDocs({
    description: "Lists a social set's tags. Each set has its own.",
    extensions: entitlement,
    operationId: 'listDraftTags',
    outputName: 'DraftTagList',
    responses: { '200': 'The tags.', '404': 'The set was not found.' },
    tag: 'Workspace',
  }),
  method: 'GET',
  name: 'social-sets.tags.list',
  output: z.object({ items: z.array(draftTagSchema) }),
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}/tags',
  summary: "List a set's tags",
})

/** `POST /api/v1/social-sets/{id}/tags` */
export const createDraftTagContract = defineContract({
  access: { apiKeyScope: 'draft:write', feature: 'content:drafts', permission: 'artifact:edit' },
  body: draftTagInputSchema.extend({ name: z.string().trim().min(1).max(40) }),
  docs: workspaceDocs({
    description: 'Adds a tag to a social set. Names are unique within a set, ignoring case.',
    extensions: entitlement,
    operationId: 'createDraftTag',
    outputName: 'DraftTag',
    responses: {
      '201': 'Tag created.',
      '400': 'The tag is invalid.',
      '409': 'The set has a tag of that name.',
    },
    tag: 'Workspace',
  }),
  method: 'POST',
  name: 'social-sets.tags.create',
  output: draftTagSchema,
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}/tags',
  status: 201,
  summary: 'Create a tag',
})

/** `PATCH /api/v1/social-sets/{id}/tags/{tagId}` */
export const updateDraftTagContract = defineContract({
  access: { apiKeyScope: 'draft:write', feature: 'content:drafts', permission: 'artifact:edit' },
  body: draftTagInputSchema,
  docs: workspaceDocs({
    description: 'Renames or recolours a tag.',
    extensions: entitlement,
    operationId: 'updateDraftTag',
    outputName: 'DraftTag',
    responses: {
      '200': 'The tag.',
      '404': 'The tag was not found.',
      '409': 'The set has a tag of that name.',
    },
    tag: 'Workspace',
  }),
  method: 'PATCH',
  name: 'social-sets.tags.update',
  output: draftTagSchema,
  params: draftTagParamsSchema,
  path: '/api/v1/social-sets/{id}/tags/{tagId}',
  summary: 'Update a tag',
})

/** `DELETE /api/v1/social-sets/{id}/tags/{tagId}` */
export const deleteDraftTagContract = defineContract({
  access: { apiKeyScope: 'draft:write', feature: 'content:drafts', permission: 'artifact:edit' },
  docs: workspaceDocs({
    description:
      "Deletes a tag and takes it off the set's drafts, without changing their versions.",
    extensions: entitlement,
    operationId: 'deleteDraftTag',
    responses: { '200': 'Tag deleted.', '404': 'The tag was not found.' },
    tag: 'Workspace',
  }),
  method: 'DELETE',
  name: 'social-sets.tags.delete',
  output: z.object({ deleted: z.literal(true) }),
  params: draftTagParamsSchema,
  path: '/api/v1/social-sets/{id}/tags/{tagId}',
  summary: 'Delete a tag',
})

/** A set's thread finisher. */
export const draftFinisherSchema = z.object({
  createdAt: timestampSchema,
  id: z.string(),
  name: z.string(),
  /** Publishing quotes the thread's first post, once it is live. */
  quoteFirstPost: z.boolean(),
  socialSetId: z.string(),
  text: z.string(),
  updatedAt: timestampSchema,
})

/** One of {@link draftFinisherSchema}. */
export type DraftFinisher = z.infer<typeof draftFinisherSchema>

/** A finisher's fields. */
export const draftFinisherInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  quoteFirstPost: z.boolean().optional(),
  text: z.string().trim().min(1).max(25_000).optional(),
})

/** Path parameters naming one of a set's finishers. */
export const draftFinisherParamsSchema = socialSetParamsSchema.extend({
  finisherId: contentDraftIdSchema,
})

/** `GET /api/v1/social-sets/{id}/finishers` */
export const listDraftFinishersContract = defineContract({
  method: 'GET',
  name: 'social-sets.finishers.list',
  output: z.object({ items: z.array(draftFinisherSchema) }),
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}/finishers',
  summary: "List a set's thread finishers",
})

/** `POST /api/v1/social-sets/{id}/finishers` */
export const createDraftFinisherContract = defineContract({
  body: draftFinisherInputSchema.extend({
    name: z.string().trim().min(1).max(80),
    text: z.string().trim().min(1).max(25_000),
  }),
  method: 'POST',
  name: 'social-sets.finishers.create',
  output: draftFinisherSchema,
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}/finishers',
  status: 201,
  summary: 'Create a thread finisher',
})

/** `PATCH /api/v1/social-sets/{id}/finishers/{finisherId}` */
export const updateDraftFinisherContract = defineContract({
  body: draftFinisherInputSchema,
  method: 'PATCH',
  name: 'social-sets.finishers.update',
  output: draftFinisherSchema,
  params: draftFinisherParamsSchema,
  path: '/api/v1/social-sets/{id}/finishers/{finisherId}',
  summary: 'Update a thread finisher',
})

/** `DELETE /api/v1/social-sets/{id}/finishers/{finisherId}` */
export const deleteDraftFinisherContract = defineContract({
  method: 'DELETE',
  name: 'social-sets.finishers.delete',
  output: z.object({ deleted: z.literal(true) }),
  params: draftFinisherParamsSchema,
  path: '/api/v1/social-sets/{id}/finishers/{finisherId}',
  summary: 'Delete a thread finisher',
})

import { z } from 'zod'
import { defineContract, timestampSchema } from '@/lib/api/contract'
import { contentDraftIdSchema } from '@/lib/api/contracts/content-drafts'
import { memberDocs, workspaceDocs } from '@/lib/api/contracts/workspace-docs'
import { automationSchema, draftChannelSchema } from '@/lib/write/document'

/**
 * Social sets (RFC 041): a workspace's publishing identities. Reads take an
 * API key with `artifact:read`; managing sets needs a signed-in owner or
 * admin. A restricted set is visible only to its members, owners and admins.
 */

const entitlement = {
  'x-shots-entitlement': { feature: 'content:drafts', minimumPlan: 'pro' },
}

/** A set's account health: usable, needs reconnecting, or turned off. */
export const connectionHealthSchema = z.enum(['healthy', 'reconnect', 'disabled'])

/** One of {@link connectionHealthSchema}. */
export type ConnectionHealth = z.infer<typeof connectionHealthSchema>

/** Who sees a set's drafts: the workspace by role, or owners, admins and listed members. */
export const socialSetVisibilitySchema = z.enum(['workspace', 'restricted'])

/** A set's colour. */
export const socialSetColorSchema = z.enum([
  'sky',
  'violet',
  'emerald',
  'amber',
  'rose',
  'orange',
  'teal',
  'indigo',
  'pink',
  'gray',
])

/** A set's writing and posting defaults. */
export const socialSetPreferencesSchema = z.strictObject({
  audience: z.string().max(2_000).optional(),
  /** The X follow-ups new drafts in the set start with. */
  automation: automationSchema.optional(),
  naturalTiming: z.boolean().optional(),
  samples: z.array(z.string().max(5_000)).max(20).optional(),
  voice: z.string().max(2_000).optional(),
})

/** A set's account as the composer shows it. */
export const socialSetConnectionSchema = z.object({
  avatarUrl: z.string().nullable(),
  channel: draftChannelSchema,
  displayName: z.string().nullable(),
  handle: z.string().nullable(),
  health: connectionHealthSchema,
  id: z.string(),
  platform: z.string(),
})

/** A social set: a publishing identity inside the workspace. */
export const socialSetSchema = z.object({
  channelConnectionIds: z.array(z.string()),
  color: socialSetColorSchema,
  connections: z.array(socialSetConnectionSchema),
  createdAt: timestampSchema,
  /** The platforms a new draft enables, in order; the first is the primary. */
  defaultChannels: z.array(draftChannelSchema),
  id: z.string(),
  /** The workspace's first set; drafts without a set belong to it. */
  isDefault: z.boolean(),
  memberUserIds: z.array(z.string()),
  name: z.string(),
  preferences: socialSetPreferencesSchema,
  /** The set's own time zone, or null for the workspace's. */
  timeZone: z.string().nullable(),
  updatedAt: timestampSchema,
  visibility: socialSetVisibilitySchema,
})

/** One of {@link socialSetSchema}. */
export type SocialSet = z.infer<typeof socialSetSchema>

/** A set's fields; an update changes those it sets. */
export const socialSetInputSchema = z.strictObject({
  channelConnectionIds: z.array(contentDraftIdSchema).max(10).optional(),
  color: socialSetColorSchema.optional(),
  defaultChannels: z.array(draftChannelSchema).max(6).optional(),
  memberUserIds: z
    .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
    .max(200)
    .optional(),
  name: z.string().trim().min(1).max(80).optional(),
  preferences: socialSetPreferencesSchema.optional(),
  /** An IANA zone, or empty for the workspace's. */
  timeZone: z.string().max(80).optional(),
  visibility: socialSetVisibilitySchema.optional(),
})

/** Path parameters naming one social set. */
export const socialSetParamsSchema = z.object({ id: contentDraftIdSchema })

/** `GET /api/v1/social-sets` */
export const listSocialSetsContract = defineContract({
  access: { apiKeyScope: 'artifact:read', feature: 'content:drafts', permission: 'artifact:read' },
  docs: workspaceDocs({
    description:
      'Lists the social sets the caller may write in, the default set first, each with its accounts and their health. A restricted set is listed only for its members, owners and admins; API keys see workspace sets only.',
    extensions: entitlement,
    operationId: 'listSocialSets',
    outputName: 'SocialSetList',
    responses: { '200': 'The social sets.' },
    tag: 'Workspace',
  }),
  method: 'GET',
  name: 'social-sets.list',
  output: z.object({ items: z.array(socialSetSchema) }),
  path: '/api/v1/social-sets',
  summary: 'List social sets',
})

/** `POST /api/v1/social-sets` */
export const createSocialSetContract = defineContract({
  access: { feature: 'content:drafts', permission: 'workspace:update' },
  body: socialSetInputSchema.extend({ name: z.string().trim().min(1).max(80) }),
  docs: memberDocs({
    description:
      'Creates a social set: a publishing identity with at most one account per platform. Owners and admins manage sets.',
    extensions: entitlement,
    operationId: 'createSocialSet',
    outputName: 'SocialSet',
    responses: {
      '201': 'Set created.',
      '400': 'The set is invalid.',
      '409': 'The workspace has as many sets as it can.',
    },
    tag: 'Workspace',
  }),
  method: 'POST',
  name: 'social-sets.create',
  output: socialSetSchema,
  path: '/api/v1/social-sets',
  status: 201,
  summary: 'Create a social set',
})

/** `GET /api/v1/social-sets/{id}` */
export const getSocialSetContract = defineContract({
  access: { apiKeyScope: 'artifact:read', feature: 'content:drafts', permission: 'artifact:read' },
  docs: workspaceDocs({
    description: 'Returns one social set with its accounts and their health.',
    extensions: entitlement,
    operationId: 'getSocialSet',
    outputName: 'SocialSet',
    responses: { '200': 'The set.', '404': 'The set was not found, or the caller may not see it.' },
    tag: 'Workspace',
  }),
  method: 'GET',
  name: 'social-sets.get',
  output: socialSetSchema,
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}',
  summary: 'Get a social set',
})

/** `PATCH /api/v1/social-sets/{id}` */
export const updateSocialSetContract = defineContract({
  access: { feature: 'content:drafts', permission: 'workspace:update' },
  body: socialSetInputSchema,
  docs: memberDocs({
    description:
      "Changes a social set's name, colour, accounts, default platforms, time zone, visibility, members or preferences.",
    extensions: entitlement,
    operationId: 'updateSocialSet',
    outputName: 'SocialSet',
    responses: {
      '200': 'The set.',
      '400': 'The change is invalid.',
      '404': 'The set was not found.',
    },
    tag: 'Workspace',
  }),
  method: 'PATCH',
  name: 'social-sets.update',
  output: socialSetSchema,
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}',
  summary: 'Update a social set',
})

/** `DELETE /api/v1/social-sets/{id}` */
export const deleteSocialSetContract = defineContract({
  access: { feature: 'content:drafts', permission: 'workspace:update' },
  docs: memberDocs({
    description:
      'Deletes an empty social set. The default set, and a set with drafts, cannot be deleted.',
    extensions: entitlement,
    operationId: 'deleteSocialSet',
    responses: {
      '200': 'Set deleted.',
      '404': 'The set was not found.',
      '409': 'The set is the default or has drafts.',
    },
    tag: 'Workspace',
  }),
  method: 'DELETE',
  name: 'social-sets.delete',
  output: z.object({ deleted: z.literal(true) }),
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}',
  summary: 'Delete a social set',
})

/** What a looked-up mention is: an X user or a LinkedIn organization. */
export const mentionKindSchema = z.enum(['person', 'organization'])

/** An account a post can tag, as its platform writes it in a post. */
export const socialMentionSchema = z.object({
  handle: z.string().optional(),
  image: z.string().optional(),
  kind: mentionKindSchema,
  label: z.string(),
  /** The X username, or a LinkedIn organization URN. */
  providerId: z.string(),
})

/** `GET /api/v1/social-sets/{id}/mentions` */
export const lookupMentionsContract = defineContract({
  access: { feature: 'content:drafts', permission: 'artifact:edit' },
  docs: memberDocs({
    description:
      "Looks a mention up with the set's own account: an X user by exact username, or a LinkedIn company page by the name in its address. LinkedIn people are not looked up.",
    extensions: entitlement,
    operationId: 'lookupSocialSetMentions',
    outputName: 'SocialMentionList',
    responses: {
      '200': 'What the account can mention; empty when nothing matches.',
      '400': 'The query is not a username or company page name.',
      '409': 'The set has no connected account for that platform.',
    },
    tag: 'Workspace',
  }),
  method: 'GET',
  name: 'social-sets.mentions',
  output: z.object({ items: z.array(socialMentionSchema) }),
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}/mentions',
  query: z.object({
    channel: z.enum(['x', 'linkedin']),
    q: z.string().trim().min(1).max(200),
  }),
  summary: 'Look up a mention for a social set',
})

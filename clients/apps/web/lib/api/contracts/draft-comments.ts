import { z } from 'zod'
import { draftCommentInputSchema } from 'screenshot-studio-backend-sdk'
/** The canonical validated member comment action. */
export { draftCommentInputSchema, type DraftCommentInput } from 'screenshot-studio-backend-sdk'
import type { mutateDraftComment } from '@/lib/tenant/draft-comments'
import { defineContract, mirrors } from '@/lib/api/contract'
import { contentDraftParamsSchema, contentDraftSchema } from '@/lib/api/contracts/content-drafts'
import { workspaceDocs } from '@/lib/api/contracts/workspace-docs'

/** The committed discussion and review/version metadata; document content is unchanged. */
export const draftCommentResultSchema = contentDraftSchema.pick({
  id: true,
  version: true,
  discussions: true,
  approvedVersion: true,
  reviewStatus: true,
  reviewNote: true,
  reviewedByUserId: true,
})

/** POST /api/v1/content-drafts/{id}/comments: member and scoped-key comments without document editing. */
export const mutateDraftCommentContract = defineContract({
  access: {
    apiKeyScope: 'draft:comment',
    feature: 'content:drafts',
    permission: 'artifact:read',
    quota: 'api:write:minute',
  },
  body: draftCommentInputSchema,
  docs: workspaceDocs({
    bodyName: 'DraftCommentAction',
    extensions: { 'x-shots-entitlement': { feature: 'content:drafts', minimumPlan: 'pro' } },
    description:
      'Adds, replies, edits, deletes or resolves a comment on a visible draft. Every active member may comment; only its author may edit a comment, while owners/admins may also delete comments. Author identities and timestamps are server-owned. A new thread may include anchor {platform, postId, quote?}; quote must match exactly once in the selected post. Omit quote to discuss the whole post. delete_thread removes a discussion; a key may only delete its own thread if all replies also belong to that key. All changes require baseVersion. A repeated or stale action returns 409 without another mutation: read the draft to reconcile an uncertain outcome before submitting a new action. Comment-only changes preserve current approval and never change publication content. API keys need the separate draft:comment scope and are attributed to their key, never a human. Private social sets remain unavailable to keys.',
    operationId: 'mutateDraftComment',
    outputName: 'DraftCommentResult',
    responses: {
      '200': 'The committed discussion and draft version.',
      '400': 'Invalid comment action.',
      '404': 'Draft or comment unavailable.',
      '409': 'Stale draft version or reused comment identifier; reload before another action.',
      '503': 'The comment service is unavailable.',
    },
    tag: 'Workspace',
  }),
  method: 'POST',
  name: 'content-drafts.comment',
  output:
    mirrors<NonNullable<Awaited<ReturnType<typeof mutateDraftComment>>>>()(
      draftCommentResultSchema
    ),
  params: contentDraftParamsSchema,
  path: '/api/v1/content-drafts/{id}/comments',
  summary: 'Comment on an authorized draft',
})

/** Filters on the existing draft discussion document. */
export const draftCommentListQuerySchema = z.object({
  status: z.enum(['all', 'open', 'resolved']).optional(),
  platform: z.enum(['x', 'linkedin', 'threads', 'bluesky', 'mastodon', 'instagram']).optional(),
})

/** Read a draft's discussion threads without acquiring comment or document write access. */
export const listDraftCommentsContract = defineContract({
  access: { apiKeyScope: 'artifact:read', feature: 'content:drafts', permission: 'artifact:read' },
  docs: workspaceDocs({
    operationId: 'listDraftComments',
    outputName: 'DraftCommentList',
    tag: 'Workspace',
    extensions: { 'x-shots-entitlement': { feature: 'content:drafts', minimumPlan: 'pro' } },
    description:
      'Lists existing discussion threads and authoritative author names. Filter by open/resolved status and platform. Whole-draft discussions apply to every platform. Private social sets remain unavailable to API keys.',
    responses: {
      '200': 'The filtered discussion document and its current version.',
      '404': 'Draft unavailable.',
    },
  }),
  method: 'GET',
  name: 'content-drafts.comments',
  params: contentDraftParamsSchema,
  query: draftCommentListQuerySchema,
  output: contentDraftSchema.pick({ id: true, version: true, discussions: true }),
  path: '/api/v1/content-drafts/{id}/comments',
  summary: 'List draft discussion threads',
})

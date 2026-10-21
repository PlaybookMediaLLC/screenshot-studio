import { draftCommentInputSchema } from 'screenshot-studio-backend-sdk'
/** The canonical validated member comment action. */
export { draftCommentInputSchema, type DraftCommentInput } from 'screenshot-studio-backend-sdk'
import type { mutateDraftComment } from '@/lib/tenant/draft-comments'
import { defineContract, mirrors } from '@/lib/api/contract'
import { contentDraftParamsSchema, contentDraftSchema } from '@/lib/api/contracts/content-drafts'
import { memberDocs } from '@/lib/api/contracts/workspace-docs'

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

/** POST /api/v1/content-drafts/{id}/comments: human comments without document editing. */
export const mutateDraftCommentContract = defineContract({
  access: { feature: 'content:drafts', permission: 'artifact:read', quota: 'api:write:minute' },
  body: draftCommentInputSchema,
  docs: memberDocs({
    bodyName: 'DraftCommentAction',
    description:
      'Adds, replies, edits, deletes or resolves a comment on a visible draft. Every active member may comment; only its author may edit a comment, while owners/admins may also delete comments. Author identities and timestamps are server-owned. All changes require baseVersion. A repeated or stale action returns 409 without another mutation: read the draft to reconcile an uncertain outcome before submitting a new action. Comment-only changes preserve current approval and never change publication content. API keys are refused.',
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

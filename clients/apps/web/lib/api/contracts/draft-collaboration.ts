import { defineContract } from '@/lib/api/contract'
import { collabTokenSchema } from '@/lib/api/contracts/content-draft-concurrency'
import { contentDraftParamsSchema } from '@/lib/api/contracts/content-drafts'

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

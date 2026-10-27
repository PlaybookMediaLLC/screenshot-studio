import 'server-only'
import type { TenantContext } from '@/lib/auth/access'
import type { z } from 'zod'
import type { draftCommentListQuerySchema } from '@/lib/api/contracts/draft-comments'
import type { DraftCommentInput } from '@/lib/api/contracts/draft-comments'
import { backendSDK, orNull } from '@/lib/backend/sdk'

/** Apply one authorized discussion action through the canonical Go draft service. */
export async function mutateDraftComment(
  context: TenantContext,
  id: string,
  input: DraftCommentInput
) {
  const draft = await orNull(backendSDK(context).mutateContentDraftComment(id, input))
  return draft
    ? {
        id: draft.id,
        version: draft.version,
        discussions: draft.discussions,
        approvedVersion: draft.approvedVersion,
        reviewStatus: draft.reviewStatus,
        reviewNote: draft.reviewNote,
        reviewedByUserId: draft.reviewedByUserId,
      }
    : null
}

/** Read a filtered discussion document through the same backend visibility checks. */
export async function listDraftComments(
  context: TenantContext,
  id: string,
  query: z.infer<typeof draftCommentListQuerySchema>
) {
  return orNull(backendSDK(context).listContentDraftComments(id, query))
}

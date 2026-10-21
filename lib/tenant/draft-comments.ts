import 'server-only'
import type { OrganizationAccess } from '@/lib/auth/access'
import type { DraftCommentInput } from '@/lib/api/contracts/draft-comments'
import { backendSDK, orNull } from '@/lib/backend/sdk'

/** Apply one authorized discussion action through the canonical Go draft service. */
export async function mutateDraftComment(
  context: OrganizationAccess,
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

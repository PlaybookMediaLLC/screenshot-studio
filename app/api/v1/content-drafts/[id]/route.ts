import {
  deleteContentDraftContract,
  getContentDraftContract,
  updateContentDraftContract,
} from '@/lib/api/contracts/content-drafts'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import {
  deleteContentDraft,
  getContentDraft,
  updateContentDraft,
} from '@/lib/tenant/content-drafts'

const notFound = () => errorResponse(404, 'Content draft not found.')

/** One content draft. */
export const GET = route(getContentDraftContract, {
  auth: tenantAccess(getContentDraftContract.access),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return notFound()
    return (await getContentDraft(access, params.id)) ?? notFound()
  },
})

/** Update a draft based on the version the client last saw; stale writes get 409. */
export const PATCH = route(updateContentDraftContract, {
  auth: tenantAccess(updateContentDraftContract.access),
  handler: async ({ access, body, params }) => {
    if (!contentDraftsEnabled()) return notFound()
    return (await updateContentDraft(access, params.id, body)) ?? notFound()
  },
})

/** Delete a content draft. */
export const DELETE = route(deleteContentDraftContract, {
  auth: tenantAccess(deleteContentDraftContract.access),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return notFound()
    return (await deleteContentDraft(access, params.id)) ? { deleted: true as const } : notFound()
  },
})

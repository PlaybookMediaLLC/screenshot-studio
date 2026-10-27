import {
  createContentDraftContract,
  listContentDraftsContract,
} from '@/lib/api/contracts/content-drafts'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { createContentDraft, listContentDrafts } from '@/lib/tenant/content-drafts'

/** The workspace's content drafts, newest first. */
export const GET = route(listContentDraftsContract, {
  auth: tenantAccess(listContentDraftsContract.access),
  handler: async ({ access, query }) =>
    contentDraftsEnabled()
      ? listContentDrafts(access, query)
      : errorResponse(404, 'Content drafts are not enabled.'),
})

/** Create a content draft. */
export const POST = route(createContentDraftContract, {
  auth: tenantAccess(createContentDraftContract.access),
  handler: async ({ access, body }) =>
    contentDraftsEnabled()
      ? createContentDraft(access, body)
      : errorResponse(404, 'Content drafts are not enabled.'),
})

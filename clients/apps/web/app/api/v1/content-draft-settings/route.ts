import {
  getContentDraftSettingsContract,
  updateContentDraftSettingsContract,
} from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { getContentDraftSettings, updateContentDraftSettings } from '@/lib/tenant/content-drafts'

/** The workspace's drafts settings: queue slots and approvals. */
export const GET = route(getContentDraftSettingsContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    return getContentDraftSettings(access)
  },
})

/** Save the drafts settings; publishers and admins only. */
export const PUT = route(updateContentDraftSettingsContract, {
  auth: organizationAccess('publish:manage'),
  handler: async ({ access, body }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    return updateContentDraftSettings(access, body)
  },
})

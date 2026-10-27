import { draftLinkCardContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { readLinkCard } from '@/lib/content-drafts/link-card'
import { linkPreviewLimit } from '@/lib/link-preview/limit'

/** The card a channel shows for a link, metered like link previews. */
export const GET = route(draftLinkCardContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, query }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    const limited = await linkPreviewLimit(access.organizationId)
    if (limited) return limited
    return (await readLinkCard(query.url)) ?? errorResponse(422, 'That page could not be read.')
  },
})

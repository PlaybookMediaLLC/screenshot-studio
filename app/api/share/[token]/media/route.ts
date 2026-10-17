import { shareMediaContract } from '@/lib/api/contracts/sharing'
import { errorResponse, route } from '@/lib/api/route'
import { publicAccess } from '@/lib/api/route-auth'
import { canViewWorkspaceLink } from '@/lib/sharing/access'
import { resolveShareLink, signedShareMedia } from '@/lib/sharing/server'

const GONE = 'This link does not exist, has expired, or was revoked.'

/**
 * `GET /api/share/{token}/media`: the published file, for share pages,
 * embeds, and link previews. After checking the link (and, for
 * workspace-only links, the viewer), it redirects to a short-lived signed
 * storage URL, so storage serves the bytes and range requests. The redirect
 * is never cached, so revoking or restricting a link takes effect at once.
 */
export const GET = route(shareMediaContract, {
  auth: publicAccess,
  handler: async ({ params, query, request }) => {
    const link = await resolveShareLink(params.token)
    if (!link) return errorResponse(404, GONE)
    if (
      link.access === 'WORKSPACE' &&
      !(await canViewWorkspaceLink(request.headers, link.organizationId))
    ) {
      return errorResponse(403, 'Only members of the workspace that shared this can open it.')
    }
    const media = await signedShareMedia(params.token, query.variant)
    if (!media) return errorResponse(404, GONE)
    return new Response(null, {
      headers: { 'cache-control': 'private, no-store', location: media.url },
      status: 302,
    })
  },
})

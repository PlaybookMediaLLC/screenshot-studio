import { renderedHeadContract } from '@/lib/api/contracts/link-preview'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { readRenderedHead } from '@/lib/link-preview/fetch'
import { linkPreviewLimit } from '@/lib/link-preview/limit'

/** A headless browser loads the page and runs its scripts. */
export const maxDuration = 45

/** `GET /api/link-preview/rendered?url=`: the page's preview tags after its JavaScript runs. */
export const GET = route(renderedHeadContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, query }) => {
    const limited = await linkPreviewLimit(access.organizationId)
    if (limited) return limited
    const result = await readRenderedHead(query.url)
    if (!result.ok) return errorResponse(result.status === 'blocked' ? 400 : 422, result.reason)
    return result.rendered
  },
})

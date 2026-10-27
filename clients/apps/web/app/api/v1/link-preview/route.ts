import { getLinkPreviewContract } from '@/lib/api/contracts/link-preview'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { auditLinkPreview } from '@/lib/link-preview/audit'
import { readLinkPreview } from '@/lib/link-preview/fetch'
import { linkPreviewLimit } from '@/lib/link-preview/limit'
import { scoreLinkPreview } from '@/lib/link-preview/metadata'

/** The page fetch and its side requests each time out on their own; this bounds the whole request. */
export const maxDuration = 30

/**
 * `GET /api/v1/link-preview?url=&agent=`: a public page's link preview check,
 * for workspace members in the app and for API keys with `artifact:read`.
 */
export const GET = route(getLinkPreviewContract, {
  auth: tenantAccess(getLinkPreviewContract.access),
  handler: async ({ access, query }) => {
    const limited = await linkPreviewLimit(access.organizationId)
    if (limited) return limited
    const result = await readLinkPreview(query.url, query.agent)
    if (!result.ok) return errorResponse(result.status === 'blocked' ? 400 : 422, result.reason)
    const { preview } = result
    return { ...preview, issues: auditLinkPreview(preview), score: scoreLinkPreview(preview).score }
  },
})

import { readSitemapContract } from '@/lib/api/contracts/link-preview'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { readSitemap } from '@/lib/link-preview/fetch'
import { linkPreviewLimit } from '@/lib/link-preview/limit'

/** A sitemap index plus a few child sitemaps. */
export const maxDuration = 30

/** `GET /api/link-preview/sitemap?url=`: a site's page URLs, to check in a batch. */
export const GET = route(readSitemapContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, query }) => {
    const limited = await linkPreviewLimit(access.organizationId)
    if (limited) return limited
    const result = await readSitemap(query.url)
    if (!result.ok) return errorResponse(result.status === 'blocked' ? 400 : 422, result.reason)
    const { sitemap, total, urls } = result
    return { sitemap, total, urls }
  },
})

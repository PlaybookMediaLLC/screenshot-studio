import { crawlerMatrixContract } from '@/lib/api/contracts/link-preview'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { readCrawlerMatrix } from '@/lib/link-preview/fetch'
import { linkPreviewLimit } from '@/lib/link-preview/limit'

/** Nine fetches in parallel, each capped at eight seconds. */
export const maxDuration = 20

/** `GET /api/link-preview/crawlers?url=`: the page as every platform crawler receives it. */
export const GET = route(crawlerMatrixContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, query }) => {
    const limited = await linkPreviewLimit(access.organizationId)
    if (limited) return limited
    return { results: await readCrawlerMatrix(query.url) }
  },
})

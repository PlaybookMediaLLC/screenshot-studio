import { shareMediaContract } from '@/lib/api/contracts/sharing'
import { errorResponse, route } from '@/lib/api/route'
import { publicAccess } from '@/lib/api/route-auth'
import { canViewWorkspaceLink } from '@/lib/sharing/access'
import { readShareMedia, resolveShareLink } from '@/lib/sharing/server'

const GONE = 'This link does not exist, has expired, or was revoked.'

/** The byte range a request asks for, clamped to the file; null for the whole file. */
function byteRange(header: string | null, size: number): { end: number; start: number } | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (!match[1] && !match[2])) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  return start <= end && start < size ? { end, start } : null
}

/**
 * `GET /api/share/{token}/media`: the published file, for share pages,
 * embeds, and link previews. Workspace-only links answer only to members;
 * video supports range requests so players can seek.
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
    const type = query.variant === 'poster' ? link.posterMediaType : link.mediaType
    const stored = type ? await readShareMedia(params.token, query.variant) : null
    if (!stored || !type) return errorResponse(404, GONE)
    const bytes = new Uint8Array(stored)
    const headers = new Headers({
      'accept-ranges': 'bytes',
      'cache-control': link.access === 'PUBLIC' ? 'public, max-age=300' : 'private, no-store',
      'content-disposition': 'inline',
      'content-type': type,
    })
    const range = byteRange(request.headers.get('range'), bytes.byteLength)
    if (range) {
      headers.set('content-range', `bytes ${range.start}-${range.end}/${bytes.byteLength}`)
      return new Response(bytes.slice(range.start, range.end + 1), { headers, status: 206 })
    }
    return new Response(bytes, { headers })
  },
})

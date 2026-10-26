import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { createTRPCContext } from '@/lib/trpc/context'
import { appRouter } from '@/lib/trpc/router'
import { errorResponse } from '@/lib/api/route'
import { isCrossOriginCookieMutation } from '@/lib/security/request-origin'
import { withBoundedBody, RequestBodyTooLargeError } from '@/lib/security/request-body'

/**
 * campaign.generate runs an agent that captures pages and renders images;
 * it needs well over the default function budget on serverless hosts.
 */
export const maxDuration = 300

async function handler(request: Request): Promise<Response> {
  if (isCrossOriginCookieMutation(request)) {
    return errorResponse(403, 'Cross-origin cookie-authenticated writes are not allowed.')
  }
  if (request.body) {
    try {
      request = await withBoundedBody(request)
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) return errorResponse(413, error.message)
      throw error
    }
  }
  return fetchRequestHandler({
    createContext: () => createTRPCContext(request.headers),
    endpoint: '/api/trpc',
    onError({ error, path }) {
      if (error.code === 'INTERNAL_SERVER_ERROR') {
        console.error(`tRPC ${path ?? '<router>'} failed.`, error.cause ?? error)
      }
    },
    req: request,
    router: appRouter,
    responseMeta: () => ({ headers: { 'Cache-Control': 'private, no-store' } }),
  })
}

export { handler as GET, handler as POST }

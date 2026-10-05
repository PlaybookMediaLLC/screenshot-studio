import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { createTRPCContext } from '@/lib/trpc/context'
import { appRouter } from '@/lib/trpc/router'

// campaign.generate runs an agent that captures pages and renders images;
// it needs well over the default function budget on serverless hosts.
export const maxDuration = 300

function handler(request: Request): Promise<Response> {
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
  })
}

export { handler as GET, handler as POST }

import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { createTRPCContext } from '@/lib/trpc/context'
import { appRouter } from '@/lib/trpc/router'

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

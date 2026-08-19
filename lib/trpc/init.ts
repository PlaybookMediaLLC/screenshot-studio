import { initTRPC } from '@trpc/server'
import superjson from 'superjson'
import { getDomainTRPCError } from './errors'
import type { TRPCContext } from './context'

const t = initTRPC.context<TRPCContext>().create({ transformer: superjson })

export const router = t.router
export const middleware = t.middleware
export const createCallerFactory = t.createCallerFactory

/**
 * Rewrites domain errors (AuthorizationError, workflow errors, dependency
 * failures) into TRPCErrors that carry the equivalent HTTP status. Every
 * procedure must build on this so client callers see the same statuses the
 * REST surface returned.
 */
const domainErrorMiddleware = middleware(async ({ next }) => {
  const result = await next()
  if (!result.ok) {
    const mapped = getDomainTRPCError(result.error.cause ?? result.error)
    if (mapped && mapped !== result.error) {
      throw mapped
    }
  }
  return result
})

export const publicProcedure = t.procedure.use(domainErrorMiddleware)

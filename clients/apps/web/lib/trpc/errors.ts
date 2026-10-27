import { TRPCError, type TRPC_ERROR_CODE_KEY } from '@trpc/server'
import { toApiFailure } from '@/lib/api/platform-errors'

const statusCodes: Partial<Record<number, TRPC_ERROR_CODE_KEY>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
}

/**
 * Map a thrown domain error to the TRPCError that carries the same HTTP
 * status the REST routes return. Both surfaces resolve errors through
 * `toApiFailure`, so they cannot disagree. Returns null when the error is not
 * a recognized domain error.
 */
export function getDomainTRPCError(error: unknown): TRPCError | null {
  if (error instanceof TRPCError) {
    return error
  }
  const failure = toApiFailure(error)
  const code = failure && statusCodes[failure.status]
  return code ? new TRPCError({ cause: error, code, message: failure.message }) : null
}

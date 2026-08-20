import { TRPCError, type TRPC_ERROR_CODE_KEY } from '@trpc/server'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'

const statusCodes: Record<number, TRPC_ERROR_CODE_KEY> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
}

const domainErrorNames = new Set([
  'AnnouncementError',
  'AuthorizationError',
  'CampaignError',
  'CreativeWorkflowError',
  'ScheduledPostError',
  'WorkspaceError',
])

function getErrorStatus(error: Error & { status?: unknown }): TRPC_ERROR_CODE_KEY | null {
  return typeof error.status === 'number' ? (statusCodes[error.status] ?? null) : null
}

function isDatabaseUnavailable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P1001') ||
    (typeof error === 'object' &&
      error !== null &&
      'body' in error &&
      typeof error.body === 'object' &&
      error.body !== null &&
      'code' in error.body &&
      error.body.code === 'FAILED_TO_GET_SESSION')
  )
}

/**
 * Map a thrown domain error to the TRPCError that carries the same HTTP
 * status the REST routes used to return. Mirrors lib/api/route-errors.ts.
 * Returns null when the error is not a recognized domain error.
 */
export function getDomainTRPCError(error: unknown): TRPCError | null {
  if (error instanceof TRPCError) {
    return error
  }
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return new TRPCError({ cause: error, code: 'BAD_REQUEST', message: 'Invalid request.' })
  }
  if (isDatabaseUnavailable(error)) {
    return new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'A required dependency is unavailable.',
    })
  }
  if (!(error instanceof Error)) {
    return null
  }
  if (error.name === 'InvalidTenantObjectKeyError') {
    return new TRPCError({ cause: error, code: 'BAD_REQUEST', message: error.message })
  }
  if (error.name === 'TenantStorageUnavailableError') {
    return new TRPCError({
      cause: error,
      code: 'SERVICE_UNAVAILABLE',
      message: 'A required dependency is unavailable.',
    })
  }
  if (error.name === 'TenantStorageObjectMissingError') {
    return new TRPCError({ cause: error, code: 'BAD_REQUEST', message: error.message })
  }
  if (domainErrorNames.has(error.name)) {
    const code = getErrorStatus(error)
    if (code) {
      return new TRPCError({ cause: error, code, message: error.message })
    }
  }
  return null
}

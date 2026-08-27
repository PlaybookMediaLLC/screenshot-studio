import assert from 'node:assert/strict'
import test from 'node:test'
import { TRPCError } from '@trpc/server'
import { ZodError } from 'zod'
import { getDomainTRPCError } from '@/lib/trpc/errors'
import { WorkspaceError } from '@/lib/workspace/errors'

function makeNamedError(name: string, message: string, status?: number): Error {
  const error = new Error(message) as Error & { status?: number }
  error.name = name
  if (status !== undefined) error.status = status
  return error
}

test('authorization errors map to the equivalent tRPC codes', () => {
  const unauthorized = getDomainTRPCError(
    makeNamedError('AuthorizationError', 'A session is required.', 401)
  )
  assert.equal(unauthorized?.code, 'UNAUTHORIZED')
  assert.equal(unauthorized?.message, 'A session is required.')

  const forbidden = getDomainTRPCError(makeNamedError('AuthorizationError', 'Denied.', 403))
  assert.equal(forbidden?.code, 'FORBIDDEN')
})

test('workflow errors carry their HTTP status through to tRPC codes', () => {
  assert.equal(
    getDomainTRPCError(makeNamedError('CampaignError', 'Campaign not found.', 404))?.code,
    'NOT_FOUND'
  )
  assert.equal(
    getDomainTRPCError(makeNamedError('ScheduledPostError', 'No longer cancellable.', 409))?.code,
    'CONFLICT'
  )
  assert.equal(
    getDomainTRPCError(makeNamedError('CreativeWorkflowError', 'Creator required.', 400))?.code,
    'BAD_REQUEST'
  )
})

test('validation errors become BAD_REQUEST without leaking issue details', () => {
  const error = getDomainTRPCError(new ZodError([]))
  assert.equal(error?.code, 'BAD_REQUEST')
  assert.equal(error?.message, 'Invalid request.')
})

test('storage errors map to the same statuses the REST surface used', () => {
  assert.equal(
    getDomainTRPCError(makeNamedError('TenantStorageUnavailableError', 'Down.'))?.code,
    'SERVICE_UNAVAILABLE'
  )
  assert.equal(
    getDomainTRPCError(makeNamedError('TenantStorageObjectMissingError', 'Missing.'))?.code,
    'BAD_REQUEST'
  )
  assert.equal(
    getDomainTRPCError(makeNamedError('InvalidTenantObjectKeyError', 'Bad key.'))?.code,
    'BAD_REQUEST'
  )
})

test('existing TRPCErrors pass through unchanged', () => {
  const original = new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' })
  assert.equal(getDomainTRPCError(original), original)
})

test('unknown errors are not mapped so they surface as INTERNAL_SERVER_ERROR', () => {
  assert.equal(getDomainTRPCError(new Error('Unexpected.')), null)
  assert.equal(getDomainTRPCError('not an error'), null)
})

/**
 * Transaction failures must not read as request errors.
 *
 * A serialization conflict (P2034) and an interactive-transaction timeout
 * (P2028) are both properties of load, not of the request. Neither matches a
 * branch in getDomainTRPCError on its own, so lib/workspace/service.ts
 * converts them to WorkspaceErrors carrying a status this mapper understands.
 * CI produced the P2028 case as a 500 on a valid invite: "timeout 5000 ms,
 * however 7110 ms passed".
 */
test('workspace transaction failures map to retryable statuses, not 500', () => {
  // The real error type: the mapper keys off the error *name*, so a bare
  // Error carrying a status property is not enough. Using WorkspaceError also
  // keeps the status union honest, since 503 has to be assignable to it.
  const conflict = new WorkspaceError('The workspace changed. Please retry.', 409)
  const timeout = new WorkspaceError('The workspace service is busy. Please retry.', 503)

  assert.equal(getDomainTRPCError(conflict)?.code, 'CONFLICT')
  assert.equal(getDomainTRPCError(timeout)?.code, 'SERVICE_UNAVAILABLE')
})

test('a transaction failure left unconverted would surface as 500', () => {
  // Negative control: this is the behaviour the conversion exists to prevent,
  // so the assertions above cannot pass for an unrelated reason.
  const raw = Object.assign(new Error('Transaction already closed'), { code: 'P2028' })
  assert.equal(getDomainTRPCError(raw), null)
})

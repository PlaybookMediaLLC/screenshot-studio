import assert from 'node:assert/strict'
import test from 'node:test'
import { TRPCError } from '@trpc/server'
import { ZodError } from 'zod'
import { getDomainTRPCError } from '@/lib/trpc/errors'

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

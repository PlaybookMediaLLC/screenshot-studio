import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { failureForStatus, rateLimitHeaders, toApiFailure } from '@/lib/api/platform-errors'
import { getDomainTRPCError } from '@/lib/trpc/errors'
import { WorkspaceError } from '@/lib/workspace/errors'
import { BackendSDKError } from 'screenshot-studio-backend-sdk'

function namedError(name: string, message: string, fields: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { name }, fields)
}

const trpcStatus: Record<string, number> = {
  BAD_REQUEST: 400,
  CONFLICT: 409,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SERVICE_UNAVAILABLE: 503,
  TOO_MANY_REQUESTS: 429,
  UNAUTHORIZED: 401,
}

test('REST and tRPC resolve every domain error to the same status', () => {
  const zodError = z.object({ a: z.string() }).safeParse({}).error
  const cases: unknown[] = [
    new WorkspaceError('Workspace not found.', 404),
    new WorkspaceError('The workspace changed. Please retry.', 409),
    new BackendSDKError('Session expired.', 401),
    namedError('CampaignError', 'Campaign not found.', { status: 404 }),
    namedError('AnnouncementError', 'Already sent.', { status: 409 }),
    namedError('LaunchError', 'Spec missing.', { status: 400 }),
    namedError('TenantStorageUnavailableError', 'Down.'),
    namedError('InvalidTenantObjectKeyError', 'Bad key.'),
    zodError,
  ]
  for (const error of cases) {
    const failure = toApiFailure(error)
    const trpc = getDomainTRPCError(error)
    assert.ok(failure && trpc, String(error))
    assert.equal(trpcStatus[trpc.code], failure.status, String(error))
    assert.equal(trpc.message, failure.message)
  }
})

test('a 409 carries the conflict code instead of internal_error', () => {
  assert.equal(toApiFailure(new WorkspaceError('Changed.', 409))?.code, 'conflict')
})

test('validation and dependency failures never echo internal details', () => {
  assert.equal(
    toApiFailure(new SyntaxError('Unexpected token < in JSON'))?.message,
    'Invalid request.'
  )
  assert.deepEqual(toApiFailure({ body: { code: 'FAILED_TO_GET_SESSION' } }), {
    ...failureForStatus(503, 'A required dependency is unavailable.'),
  })
  assert.equal(
    toApiFailure(namedError('TenantStorageUnavailableError', 'bucket creds expired'))?.message,
    'A required dependency is unavailable.'
  )
})

test('quota errors use the documented X-RateLimit headers', () => {
  const resetAt = Date.now() + 30_000
  const failure = toApiFailure(
    namedError('WorkspaceQuotaError', 'Over quota.', {
      limit: 5,
      quota: 'api:write:minute',
      resetAt,
      status: 429,
    })
  )
  assert.equal(failure?.code, 'workspace_quota_exceeded')
  assert.deepEqual(failure?.extra, { limit: 5, quota: 'api:write:minute' })
  assert.deepEqual(failure?.headers, rateLimitHeaders(5, resetAt))
  assert.ok(Object.keys(failure?.headers ?? {}).every((name) => !name.startsWith('x-rate')))
})

test('a backend plan gate becomes the entitlement envelope', () => {
  const failure = toApiFailure(
    new BackendSDKError('Upgrade required.', 403, {
      code: 'workspace_feature_not_entitled',
      currentPlan: 'free',
      feature: 'asset:delete',
      requiredPlan: 'pro',
    })
  )
  assert.equal(failure?.code, 'workspace_feature_not_entitled')
  assert.deepEqual(failure?.extra, {
    currentPlan: 'free',
    feature: 'asset:delete',
    requiredPlan: 'pro',
  })
  assert.deepEqual(failure?.headers, { 'x-current-plan': 'free', 'x-required-plan': 'pro' })
})

test('unknown errors are left for the caller to log as a 500', () => {
  assert.equal(toApiFailure(new Error('Unexpected.')), null)
  assert.equal(toApiFailure(namedError('PrismaClientKnownRequestError', 'P2028')), null)
  assert.equal(toApiFailure('not an error'), null)
})

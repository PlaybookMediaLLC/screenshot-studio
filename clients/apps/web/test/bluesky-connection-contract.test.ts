import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ScreenshotStudioBackendSDK } from '../../../packages/screenshot-studio-backend-sdk/src/index'
import {
  blueskyConnectionBeginSchema,
  blueskyConnectionCompleteSchema,
  blueskyConnectionCompleteResponseSchema,
} from '../../../packages/screenshot-studio-backend-sdk/src/bluesky-connections'

const state = 'disposable_bluesky_attempt_state_0123456789'

test('Bluesky requires an explicit intent and rejects ambiguous destinations', () => {
  for (const input of [
    {},
    { operation: 'CREATE_SET' },
    { operation: 'ADD_ACCOUNT' },
    { operation: 'RECONNECT', socialSetId: 'original' },
    { operation: 'CREATE_SET', creationVisibility: 'PRIVATE', socialSetId: 'existing' },
    { operation: 'ADD_ACCOUNT', socialSetId: 'original', instanceServer: 'elsewhere.social' },
  ])
    assert.equal(blueskyConnectionBeginSchema.safeParse(input).success, false)
  assert.equal(
    blueskyConnectionBeginSchema.safeParse({
      operation: 'CREATE_SET',
      creationVisibility: 'PRIVATE',
    }).success,
    true
  )
  assert.equal(
    blueskyConnectionBeginSchema.safeParse({
      operation: 'RECONNECT',
      socialSetId: 'original',
      expectedConnectionId: 'original-account',
    }).success,
    true
  )
})

test('Bluesky credentials normalize public handles and allow state-only recovery', () => {
  const credentials = { handle: ' @ME.BSKY.SOCIAL ', appPassword: 'abcd-efgh-ijkl-mnop' }
  assert.equal(
    blueskyConnectionCompleteSchema.parse({ state, credentials }).credentials?.handle,
    'me.bsky.social'
  )
  assert.deepEqual(blueskyConnectionCompleteSchema.parse({ state }), { state })
  for (const handle of [
    'me',
    'me.local',
    '127.0.0.1',
    'https://me.bsky.social',
    'me.bsky.social/path',
  ])
    assert.equal(
      blueskyConnectionCompleteSchema.safeParse({ state, credentials: { ...credentials, handle } })
        .success,
      false
    )
  for (const extra of [{ service: 'https://elsewhere.social' }, { password: 'primary-password' }])
    assert.equal(
      blueskyConnectionCompleteSchema.safeParse({
        state,
        credentials: { ...credentials, ...extra },
      }).success,
      false
    )
  assert.equal(
    blueskyConnectionCompleteSchema.safeParse({ state: 'short', credentials }).success,
    false
  )
  assert.equal(
    blueskyConnectionCompleteSchema.safeParse({
      state,
      credentials: { ...credentials, appPassword: 'primary-password' },
    }).success,
    false
  )
  assert.equal(
    blueskyConnectionCompleteResponseSchema.safeParse({
      completed: true,
      connectionId: 'id',
      socialSetId: 'set',
      organizationId: 'org',
      returnPath: 'https://elsewhere.social',
    }).success,
    false
  )
})

test('SDK posts credentials once and recovery omits them', async () => {
  const bodies: string[] = []
  const client = new ScreenshotStudioBackendSDK(
    'https://backend.test',
    'fixture-service',
    {
      organizationId: 'original-workspace',
      requestId: 'request',
      sessionId: 'session',
      userId: 'user',
    },
    async (input, init) => {
      assert.equal(String(input), 'https://backend.test/v1/social-connections/bluesky/connect')
      assert.equal(init?.method, 'POST')
      assert.equal(new Headers(init?.headers).get('x-organization-id'), 'original-workspace')
      bodies.push(String(init?.body))
      return Response.json({
        completed: true,
        connectionId: 'id',
        socialSetId: 'set',
        organizationId: 'original-workspace',
        returnPath: '',
      })
    }
  )
  await client.completeBlueskyConnection({
    state,
    credentials: { handle: '@ME.BSKY.SOCIAL', appPassword: 'abcd-efgh-ijkl-mnop' },
  })
  await client.completeBlueskyConnection({ state })
  assert.equal(bodies.length, 2)
  assert.deepEqual(JSON.parse(bodies[0]), {
    state,
    credentials: { handle: 'me.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' },
  })
  assert.deepEqual(JSON.parse(bodies[1]), { state })
})

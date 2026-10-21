import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ScreenshotStudioBackendSDK } from '../packages/screenshot-studio-backend-sdk/src/index'

test('OAuth begin sends the exact reconnect target and attempt return path', async () => {
  const client = new ScreenshotStudioBackendSDK(
    'https://backend.test',
    'fixture-service',
    {
      organizationId: 'original-workspace',
      requestId: 'request',
      sessionId: 'session',
      userId: 'user',
    },
    async (_input, init) => {
      assert.equal(new Headers(init?.headers).get('x-organization-id'), 'original-workspace')
      assert.deepEqual(JSON.parse(String(init?.body)), {
        provider: 'x',
        socialSetId: 'originalset1234',
        expectedConnectionId: 'original-connection',
        returnPath: '/workspace/social-sets/originalset1234',
      })
      return Response.json({ url: 'https://api.x.com/oauth/authorize?oauth_token=fixture' })
    }
  )
  await client.beginSocialOAuth('x', 'originalset1234', {
    expectedConnectionId: 'original-connection',
    returnPath: '/workspace/social-sets/originalset1234',
  })
})

test('OAuth context accepts only the backend validated local return destination', async () => {
  const client = new ScreenshotStudioBackendSDK(
    'https://backend.test',
    'fixture-service',
    {
      organizationId: '',
      requestId: 'request',
      sessionId: 'session',
      userId: 'user',
    },
    async (_input, init) => {
      assert.equal(new Headers(init?.headers).get('x-session-id'), 'session')
      return Response.json({
        organizationId: 'original-workspace',
        socialSetId: null,
        returnPath: 'https://elsewhere.test',
      })
    }
  )
  await assert.rejects(client.resolveSocialOAuthContext('x', 'state'))
})

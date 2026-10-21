import assert from 'node:assert/strict'
import test from 'node:test'
import { ScreenshotStudioBackendSDK } from '../packages/screenshot-studio-backend-sdk/src/index'
import {
  mastodonInstanceSchema,
  socialInstanceQuerySchema,
} from '../packages/screenshot-studio-backend-sdk/src/social-instances'

test('instance previews use the scoped backend and validate safe public metadata', async () => {
  const client = new ScreenshotStudioBackendSDK(
    'https://backend.test',
    'fixture-service',
    {
      organizationId: 'workspace',
      requestId: 'request',
      sessionId: 'session',
      userId: 'user',
    },
    async (url, init) => {
      assert.match(String(url), /social-instances\/mastodon\?server=social.example$/)
      assert.equal(new Headers(init?.headers).get('x-organization-id'), 'workspace')
      return Response.json({
        origin: 'https://social.example',
        title: 'Community',
        description: 'Welcome',
        activeUsers: 123,
      })
    }
  )
  assert.equal((await client.previewMastodonInstance(' social.example ')).activeUsers, 123)
  assert.equal(socialInstanceQuerySchema.safeParse({ server: '   ' }).success, false)
  assert.equal(
    socialInstanceQuerySchema.safeParse({ server: 'social.example', token: 'secret' }).success,
    false
  )
  assert.equal(
    mastodonInstanceSchema.safeParse({
      origin: 'http://local',
      title: 'X',
      description: '',
      activeUsers: -1,
    }).success,
    false
  )
  for (const server of [
    'https://user:secret@social.example',
    'https://social.example/path',
    'http://social.example',
    'https://social.example?token=secret',
    'https://social.example:443',
    'https://social.example:',
    '127.0.0.1',
  ]) {
    assert.equal(socialInstanceQuerySchema.safeParse({ server }).success, false)
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BackendSDKError,
  ScreenshotStudioBackendSDK,
} from '../packages/screenshot-studio-backend-sdk/src'

test('announcement SDK sends scoped requests to the backend', async () => {
  const requests: { body?: unknown; headers: Headers; method?: string; url: URL }[] = []
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'service-secret',
    { organizationId: 'org-1', requestId: 'req-1', sessionId: 'session-1', userId: 'user-1' },
    async (input, init) => {
      const url = new URL(String(input))
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: new Headers(init?.headers),
        method: init?.method,
        url,
      })
      if (url.pathname.endsWith('/cancel')) {
        return Response.json({ error: 'publishing permission is denied' }, { status: 403 })
      }
      return Response.json({ announcements: [], reach: 2, subscribers: [] })
    }
  )

  await sdk.listAnnouncements(25)
  await sdk.scheduleAnnouncement({
    idempotencyKey: 'key-1',
    releaseDocumentId: 'doc-1',
    scheduledFor: new Date('2030-01-01T00:00:00.000Z'),
  })
  await assert.rejects(
    sdk.cancelAnnouncement('comm/1'),
    (error) => error instanceof BackendSDKError && error.status === 403
  )
  assert.deepEqual(await sdk.getAudienceReach(), { announcements: [], reach: 2, subscribers: [] })
  await sdk.listAudienceSubscribers({ includeUnsubscribed: true, limit: 10 })
  await sdk.addAudienceSubscribers([{ email: 'a@example.com' }])
  await sdk.unsubscribeAudienceMember('a@example.com')

  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url.pathname}${request.url.search}`),
    [
      'GET /v1/announcements?limit=25',
      'POST /v1/announcements',
      'POST /v1/announcements/comm%2F1/cancel',
      'GET /v1/audience/reach',
      'GET /v1/audience/subscribers?limit=10&includeUnsubscribed=true',
      'POST /v1/audience/subscribers',
      'POST /v1/audience/unsubscribe',
    ]
  )
  assert.deepEqual(requests[1].body, {
    idempotencyKey: 'key-1',
    releaseDocumentId: 'doc-1',
    scheduledFor: '2030-01-01T00:00:00.000Z',
  })
  assert.deepEqual(requests[5].body, { subscribers: [{ email: 'a@example.com' }] })
  assert.deepEqual(requests[6].body, { email: 'a@example.com' })
  assert.equal(requests[0].headers.get('x-organization-id'), 'org-1')
  assert.equal(requests[0].headers.get('x-session-id'), 'session-1')
})

test('unsubscribe uses a service scope named by the address', async () => {
  let headers = new Headers()
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'service-secret',
    { display: 'a@example.com', kind: 'service', organizationId: 'org-1', requestId: 'req-1' },
    async (_input, init) => {
      headers = new Headers(init?.headers)
      return Response.json({ unsubscribed: true })
    }
  )

  assert.deepEqual(await sdk.unsubscribeAudienceMember('a@example.com'), { unsubscribed: true })
  assert.equal(headers.get('x-principal-kind'), 'service')
  assert.equal(headers.get('x-principal-display'), 'a@example.com')
  assert.equal(headers.get('x-user-id'), null)
})

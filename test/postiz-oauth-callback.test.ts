import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { startHttpMockServer, type HttpMockServer } from '../e2e/framework/http-server'
import { completeSocialOAuth, selectInstagramAccount } from '../lib/tenant/postiz-oauth-callback'

let server: HttpMockServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
  delete process.env.POSTIZ_API_URL
  delete process.env.BETTER_AUTH_SECRET
})

test('X maps its OAuth 1 callback fields to the Go connection endpoint', async () => {
  server = await startHttpMockServer(() => ({ body: { id: 'go-x', pages: [] } }))
  process.env.POSTIZ_API_URL = `${server.url}/public/v1`
  const result = await completeSocialOAuth(
    new Request('http://localhost/integrations/social/x?oauth_token=token&oauth_verifier=verifier'),
    'x'
  )
  assert.equal(result.status, 200)
  assert.deepEqual(
    server.calls.map((call) => call.url),
    ['/integrations/social-connect/x']
  )
  assert.deepEqual(JSON.parse(server.calls[0]?.body ?? ''), {
    code: 'verifier',
    state: 'token',
    timezone: '0',
  })
})

test('Instagram Login forwards code and state without exposing the Go response', async () => {
  server = await startHttpMockServer(() => ({ body: { id: 'go-ig', pages: [] } }))
  process.env.POSTIZ_API_URL = `${server.url}/public/v1`
  const result = await completeSocialOAuth(
    new Request(
      'http://localhost/integrations/social/instagram-standalone?code=code1&state=state1'
    ),
    'instagram-standalone'
  )
  assert.equal(result.status, 200)
  assert.match(await result.text(), /connected/)
  assert.deepEqual(JSON.parse(server.calls[0]?.body ?? ''), {
    code: 'code1',
    state: 'state1',
    timezone: '0',
  })
})

test('Facebook Login requires a linked Instagram account selection', async () => {
  server = await startHttpMockServer((request) =>
    request.url === '/integrations/social-connect/instagram'
      ? { body: { id: 'go-ig', pages: [{ id: 'ig1', pageId: 'fb1', name: 'Company <A>' }] } }
      : { body: { success: true } }
  )
  process.env.POSTIZ_API_URL = `${server.url}/public/v1`
  process.env.BETTER_AUTH_SECRET = 'test-picker-secret'
  const url = 'http://localhost/integrations/social/instagram?code=code1&state=state1'
  const picker = await completeSocialOAuth(new Request(url), 'instagram')
  assert.equal(picker.status, 200)
  const html = await picker.text()
  assert.match(html, /Company &lt;A&gt;/)
  assert.doesNotMatch(html, /Company <A>/)
  assert.equal(picker.headers.get('Referrer-Policy'), 'no-referrer')
  const choice = html.match(/name="choice" value="([^"]+)"/)?.[1]
  assert.ok(choice)

  const selected = await selectInstagramAccount(
    new Request(url, {
      body: new URLSearchParams({ choice }),
      headers: { origin: 'http://localhost' },
      method: 'POST',
    })
  )
  assert.equal(selected.status, 200)
  assert.deepEqual(
    server.calls.map((call) => call.url),
    ['/integrations/social-connect/instagram', '/integrations/public/provider/go-ig/connect']
  )
  assert.deepEqual(JSON.parse(server.calls[1]?.body ?? ''), {
    id: 'ig1',
    pageId: 'fb1',
    state: 'state1',
  })

  const rejected = await selectInstagramAccount(
    new Request(url, {
      body: new URLSearchParams({ choice: `${choice}tampered` }),
      headers: { origin: 'http://localhost' },
      method: 'POST',
    })
  )
  assert.equal(rejected.status, 400)
  assert.equal(server.calls.length, 2)
})

test('invalid OAuth callbacks make no Go request', async () => {
  server = await startHttpMockServer(() => ({ body: { id: 'go-x' } }))
  process.env.POSTIZ_API_URL = `${server.url}/public/v1`
  for (const [url, provider] of [
    ['http://localhost/integrations/social/x?oauth_token=a&oauth_verifier=b&state=c', 'x'],
    ['http://localhost/integrations/social/x?denied=a', 'x'],
    ['http://localhost/integrations/social/instagram?code=c', 'instagram'],
    ['http://localhost/integrations/social/unknown?code=c&state=s', 'unknown'],
  ]) {
    const response = await completeSocialOAuth(new Request(url), provider)
    assert.ok(response.status >= 400)
  }
  assert.equal(server.calls.length, 0)
})

test('page selection rejects cross-origin form submission', async () => {
  process.env.BETTER_AUTH_SECRET = 'test-picker-secret'
  const result = await selectInstagramAccount(
    new Request('http://localhost/integrations/social/instagram', {
      body: new URLSearchParams({ choice: 'invalid' }),
      headers: { origin: 'https://other.test' },
      method: 'POST',
    })
  )
  assert.equal(result.status, 403)
})

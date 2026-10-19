import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { completeSocialOAuth, selectInstagramAccount } from '../lib/tenant/social-oauth-callback'

afterEach(() => {
  delete process.env.BETTER_AUTH_SECRET
})

test('X maps its OAuth 1 callback fields to the backend exchange', async () => {
  const calls: string[][] = []
  const result = await completeSocialOAuth(
    new Request('http://localhost/integrations/social/x?oauth_token=token&oauth_verifier=verifier'),
    'x',
    {
      exchange: async (state, code) => {
        calls.push([state, code])
        return { id: 'go-x', pages: [] }
      },
    }
  )
  assert.equal(result.status, 303)
  assert.equal(result.headers.get('Location'), '/workspace/channels?connected=x')
  assert.deepEqual(calls, [['token', 'verifier']])
})

test('Instagram Login forwards code and state without exposing the backend response', async () => {
  const calls: string[][] = []
  const result = await completeSocialOAuth(
    new Request(
      'http://localhost/integrations/social/instagram-standalone?code=code1&state=state1'
    ),
    'instagram-standalone',
    {
      exchange: async (state, code) => {
        calls.push([state, code])
        return { id: 'go-ig', pages: [] }
      },
    }
  )
  assert.equal(result.status, 303)
  assert.equal(result.headers.get('Location'), '/workspace/channels?connected=instagram-standalone')
  assert.deepEqual(calls, [['state1', 'code1']])
})

test('LinkedIn uses the same session-bound callback exchange', async () => {
  const result = await completeSocialOAuth(
    new Request('http://localhost/integrations/social/linkedin?code=code1&state=state1'),
    'linkedin',
    { exchange: async () => ({ id: 'go-linkedin' }) }
  )
  assert.equal(result.status, 303)
})

test('Facebook Login requires a linked Instagram account selection', async () => {
  process.env.BETTER_AUTH_SECRET = 'test-picker-secret'
  const url = 'http://localhost/integrations/social/instagram?code=code1&state=state1'
  const picker = await completeSocialOAuth(new Request(url), 'instagram', {
    exchange: async () => ({
      id: 'go-ig',
      pages: [{ id: 'ig1', pageId: 'fb1', name: 'Company <A>' }],
    }),
  })
  assert.equal(picker.status, 200)
  const html = await picker.text()
  assert.match(html, /Company &lt;A&gt;/)
  assert.doesNotMatch(html, /Company <A>/)
  assert.equal(picker.headers.get('Referrer-Policy'), 'no-referrer')
  const choice = html.match(/name="choice" value="([^"]+)"/)?.[1]
  assert.ok(choice)

  const selections: unknown[] = []
  const selected = await selectInstagramAccount(
    new Request(url, {
      body: new URLSearchParams({ choice }),
      headers: { origin: 'http://localhost' },
      method: 'POST',
    }),
    {
      selectPage: async (value) => {
        selections.push(value)
      },
    }
  )
  assert.equal(selected.status, 303)
  assert.equal(selected.headers.get('Location'), '/workspace/channels?connected=instagram')
  assert.deepEqual(selections, [
    {
      accountId: 'ig1',
      expiresAt: (selections[0] as { expiresAt: number }).expiresAt,
      integrationId: 'go-ig',
      pageId: 'fb1',
      state: 'state1',
    },
  ])

  const rejected = await selectInstagramAccount(
    new Request(url, {
      body: new URLSearchParams({ choice: `${choice}tampered` }),
      headers: { origin: 'http://localhost' },
      method: 'POST',
    }),
    {
      selectPage: async (value) => {
        selections.push(value)
      },
    }
  )
  assert.equal(rejected.status, 400)
  assert.equal(selections.length, 1)
})

test('invalid OAuth callbacks make no backend request', async () => {
  let exchanges = 0
  for (const [url, provider] of [
    ['http://localhost/integrations/social/x?oauth_token=a&oauth_verifier=b&state=c', 'x'],
    ['http://localhost/integrations/social/x?denied=a', 'x'],
    ['http://localhost/integrations/social/instagram?code=c', 'instagram'],
    ['http://localhost/integrations/social/linkedin?code=c', 'linkedin'],
    ['http://localhost/integrations/social/unknown?code=c&state=s', 'unknown'],
  ]) {
    const response = await completeSocialOAuth(new Request(url), provider, {
      exchange: async () => {
        exchanges++
        return { id: 'unexpected' }
      },
    })
    assert.ok(response.status >= 400)
  }
  assert.equal(exchanges, 0)
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

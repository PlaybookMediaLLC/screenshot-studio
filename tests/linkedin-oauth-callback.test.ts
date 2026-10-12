import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { NextRequest } from 'next/server'
import { GET } from '../app/[locale]/integrations/social/linkedin/route'

const originalFetch = globalThis.fetch
const originalURL = process.env.POSTIZ_API_URL

before(() => {
  process.env.POSTIZ_API_URL = 'http://screenshot-studio-backend.internal:3000/public/v1'
})

after(() => {
  globalThis.fetch = originalFetch
  if (originalURL === undefined) delete process.env.POSTIZ_API_URL
  else process.env.POSTIZ_API_URL = originalURL
})

test('LinkedIn callback rejects a missing state without calling the backend', async () => {
  globalThis.fetch = async () => {
    assert.fail('backend should not be called')
  }
  const response = await GET(
    new NextRequest('https://shots.oppulence.io/integrations/social/linkedin?code=abc')
  )
  assert.equal(response.status, 400)
})

test('LinkedIn callback exchanges a one-use state with the Go backend', async () => {
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      'http://screenshot-studio-backend.internal:3000/integrations/social-connect/linkedin'
    )
    assert.equal(init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(init?.body)), {
      code: 'auth-code',
      state: 'one-use-state',
      timezone: '0',
    })
    return new Response('{}', { status: 201 })
  }
  const response = await GET(
    new NextRequest(
      'https://shots.oppulence.io/integrations/social/linkedin?code=auth-code&state=one-use-state'
    )
  )
  assert.equal(response.status, 200)
  assert.match(await response.text(), /LinkedIn connected/)
})

test('LinkedIn callback does not report a failed backend exchange as connected', async () => {
  globalThis.fetch = async () => new Response('expired state', { status: 400 })
  const response = await GET(
    new NextRequest(
      'https://shots.oppulence.io/integrations/social/linkedin?code=auth-code&state=expired'
    )
  )
  assert.equal(response.status, 502)
  assert.doesNotMatch(await response.text(), /expired state/)
})

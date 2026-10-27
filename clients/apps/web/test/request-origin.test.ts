import assert from 'node:assert/strict'
import test from 'node:test'
import { getAuthBaseUrl } from '@/lib/auth/environment'
import { isCrossOriginCookieMutation } from '@/lib/security/request-origin'

const origin = new URL(getAuthBaseUrl()).origin
const request = (headers: Record<string, string>, method = 'POST') =>
  new Request(`${origin}/api/v1/content-drafts`, { method, headers })

test('cookie mutations reject cross-origin and opaque origins, even with same-site metadata', () => {
  for (const maliciousOrigin of [
    'https://attacker.example',
    'null',
    `${origin}.attacker.example`,
  ]) {
    assert.equal(
      isCrossOriginCookieMutation(
        request({
          cookie: 'better-auth.session_token=test',
          origin: maliciousOrigin,
          'sec-fetch-site': 'same-site',
        })
      ),
      true
    )
  }
  for (const site of ['cross-site', 'same-site', 'none']) {
    assert.equal(
      isCrossOriginCookieMutation(request({ cookie: 'session=test', 'sec-fetch-site': site })),
      true
    )
  }
})

test('same-origin browsers, safe reads, API keys, webhooks, and native clients remain supported', () => {
  const clients: Record<string, string>[] = [
    { cookie: 'session=test', origin },
    { cookie: 'session=test', 'sec-fetch-site': 'same-origin' },
    { cookie: 'session=test' },
    { 'x-api-key': 'key', origin: 'https://api-client.example' },
    { 'x-webhook-signature': 'signed' },
  ]
  for (const headers of clients) assert.equal(isCrossOriginCookieMutation(request(headers)), false)
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(
      isCrossOriginCookieMutation(
        request({ cookie: 'session=test', origin: 'https://attacker.example' }, method)
      ),
      false
    )
  }
})

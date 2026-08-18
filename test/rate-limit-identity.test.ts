import assert from 'node:assert/strict'
import test from 'node:test'
import { getClientIdentifier, getClientIp } from '@/lib/api/client-identity'
import { AUTH_RATE_LIMIT, SCREENSHOT_RATE_LIMIT } from '@/lib/api/rate-limit-policy'

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries)
}

test('cloudflare connecting IP wins over client-supplied forwarding headers', () => {
  // x-forwarded-for is attacker-controlled: trusting it first would let a
  // caller mint a fresh rate-limit bucket on every request.
  const spoofed = headers({
    'cf-connecting-ip': '203.0.113.7',
    'x-forwarded-for': '10.0.0.1, 70.41.3.18',
    'x-real-ip': '10.0.0.2',
  })

  assert.equal(getClientIp(spoofed), '203.0.113.7')
  assert.equal(getClientIdentifier(spoofed), '203.0.113.7')
})

test('client IP falls back through forwarding headers when Cloudflare is absent', () => {
  assert.equal(
    getClientIp(headers({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1' })),
    '198.51.100.4'
  )
  assert.equal(getClientIp(headers({ 'x-real-ip': '198.51.100.9' })), '198.51.100.9')
})

test('unresolvable clients share one bucket instead of escaping the limit', () => {
  assert.equal(getClientIp(headers({})), null)
  assert.equal(getClientIdentifier(headers({})), 'unknown')
  // Blank and whitespace-only headers must not be treated as a valid identity.
  assert.equal(getClientIdentifier(headers({ 'cf-connecting-ip': '   ' })), 'unknown')
})

test('auth limit is stricter than screenshot capture and uses a separate namespace', () => {
  assert.ok(
    AUTH_RATE_LIMIT.maxRequests < SCREENSHOT_RATE_LIMIT.maxRequests,
    'credential endpoints must be throttled harder than capture'
  )
  assert.notEqual(
    AUTH_RATE_LIMIT.name,
    SCREENSHOT_RATE_LIMIT.name,
    'shared namespaces would let capture traffic exhaust the sign-in budget'
  )
})

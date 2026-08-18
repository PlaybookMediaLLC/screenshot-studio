import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import {
  assertSignInMethodAvailable,
  getEnabledSocialProviders,
  isPasswordAuthEnabled,
} from '@/lib/auth/methods'

const AUTH_KEYS = [
  'AUTH_ENABLE_PASSWORD',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET',
] as const

function clearAuthEnvironment(): void {
  for (const key of AUTH_KEYS) {
    delete process.env[key]
  }
}

afterEach(clearAuthEnvironment)

test('password auth stays enabled unless explicitly disabled', () => {
  clearAuthEnvironment()
  // Self-hosted and local setups must keep working without new configuration.
  assert.equal(isPasswordAuthEnabled(), true)

  process.env.AUTH_ENABLE_PASSWORD = 'true'
  assert.equal(isPasswordAuthEnabled(), true)

  process.env.AUTH_ENABLE_PASSWORD = 'false'
  assert.equal(isPasswordAuthEnabled(), false)
})

test('a provider is only enabled when both halves of its credential pair exist', () => {
  clearAuthEnvironment()
  assert.deepEqual(getEnabledSocialProviders(), [])

  // A half-configured provider would render a button that always fails.
  process.env.GOOGLE_CLIENT_ID = 'google-client-id'
  assert.deepEqual(getEnabledSocialProviders(), [])

  process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret'
  assert.deepEqual(getEnabledSocialProviders(), ['google'])

  process.env.GITHUB_CLIENT_ID = 'github-client-id'
  process.env.GITHUB_CLIENT_SECRET = 'github-client-secret'
  assert.deepEqual(getEnabledSocialProviders(), ['google', 'github'])
})

test('disabling passwords without an OAuth provider is rejected as a lockout', () => {
  clearAuthEnvironment()
  process.env.AUTH_ENABLE_PASSWORD = 'false'

  // This is the exact misconfiguration that would leave no way to sign in,
  // including for administrators, so it must fail loudly at startup.
  assert.throws(() => assertSignInMethodAvailable(), /No sign-in method is configured/)

  process.env.GOOGLE_CLIENT_ID = 'google-client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret'
  assert.doesNotThrow(() => assertSignInMethodAvailable())
})

test('password auth alone satisfies the sign-in requirement', () => {
  clearAuthEnvironment()
  assert.doesNotThrow(() => assertSignInMethodAvailable())
})

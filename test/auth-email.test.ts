import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import { getAuthEmailSender, isAuthEmailConfigured } from '@/lib/auth/email'

const EMAIL_KEYS = ['RESEND_API_KEY', 'AUTH_EMAIL_WEBHOOK_URL', 'AUTH_EMAIL_FROM'] as const

function clearEmailEnvironment(): void {
  for (const key of EMAIL_KEYS) {
    delete process.env[key]
  }
}

afterEach(clearEmailEnvironment)

test('either transport satisfies the email configuration requirement', () => {
  clearEmailEnvironment()
  // Neither configured: invitations and verification links cannot be sent.
  assert.equal(isAuthEmailConfigured(), false)

  process.env.RESEND_API_KEY = 're_test_key'
  assert.equal(isAuthEmailConfigured(), true)

  delete process.env.RESEND_API_KEY
  process.env.AUTH_EMAIL_WEBHOOK_URL = 'https://mail.example.com/send'
  assert.equal(isAuthEmailConfigured(), true)
})

test('an empty API key does not count as configured', () => {
  clearEmailEnvironment()
  // Fly injects empty strings for unset secrets in some paths; treating
  // that as configured would select Resend and fail every send.
  process.env.RESEND_API_KEY = ''
  assert.equal(isAuthEmailConfigured(), false)
})

test('sender defaults to a verified domain and accepts display-name form', () => {
  clearEmailEnvironment()
  // The default must sit on a domain verified with the provider, or every
  // send is rejected at delivery time rather than at configuration time.
  assert.match(getAuthEmailSender(), /@oppulence\.app>?$/)

  process.env.AUTH_EMAIL_FROM = 'Screenshot Studio <hello@oppulence.app>'
  assert.equal(getAuthEmailSender(), 'Screenshot Studio <hello@oppulence.app>')

  process.env.AUTH_EMAIL_FROM = 'hello@oppulence.app'
  assert.equal(getAuthEmailSender(), 'hello@oppulence.app')
})

test('a malformed sender is rejected instead of failing at send time', () => {
  clearEmailEnvironment()
  process.env.AUTH_EMAIL_FROM = 'not-an-email'
  assert.throws(() => getAuthEmailSender())

  process.env.AUTH_EMAIL_FROM = 'Studio <also-not-an-email>'
  assert.throws(() => getAuthEmailSender())
})

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import {
  getWebhookReleaseInput,
  hasFreshWebhookTimestamp,
  verifyGitLabWebhookSignature,
  verifyWebhookSignature,
} from '@/lib/tenant/webhook-security'

test('webhook signatures use a timing-safe HMAC comparison', () => {
  const body = '{"title":"Launch","benefitStatement":"Faster exports"}'
  const secret = 'webhook-secret'
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  assert.equal(verifyWebhookSignature(body, signature, secret), true)
  assert.equal(verifyWebhookSignature(body, `${signature}0`, secret), false)
})

test('webhook parsing supports GitHub releases and rejects stale timestamps', () => {
  const release = getWebhookReleaseInput(
    'github',
    'release',
    JSON.stringify({
      release: { body: 'Faster exports', name: 'v1.2.0' },
    })
  )
  assert.deepEqual(release, { benefitStatement: 'Faster exports', title: 'v1.2.0' })
  assert.equal(hasFreshWebhookTimestamp(new Date().toISOString()), true)
  assert.equal(
    hasFreshWebhookTimestamp(new Date(Date.now() - 10 * 60 * 1_000).toISOString()),
    false
  )
})

test('GitLab signing tokens bind a fresh event ID, timestamp, and body', () => {
  const body = JSON.stringify({ description: 'GitLab release', name: 'v2.0.0' })
  const eventId = 'gitlab-event'
  const timestamp = Math.floor(Date.now() / 1_000).toString()
  const rawSecret = Buffer.from('gitlab-signing-secret')
  const signingToken = `whsec_${rawSecret.toString('base64')}`
  const message = `${eventId}.${timestamp}.${body}`
  const signature = `v1,${createHmac('sha256', rawSecret).update(message).digest('base64')}`
  assert.equal(
    verifyGitLabWebhookSignature({ body, eventId, signature, signingToken, timestamp }),
    true
  )
  assert.deepEqual(getWebhookReleaseInput('gitlab', 'Release Hook', body), {
    benefitStatement: 'GitLab release',
    title: 'v2.0.0',
  })
})

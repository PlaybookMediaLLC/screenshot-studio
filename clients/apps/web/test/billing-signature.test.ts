import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { verifyBillingSignature } from '@/lib/billing/signature'

test('billing signatures bind the exact raw body', () => {
  const body = '{"eventId":"evt_1"}'
  const secret = 'test-billing-secret'
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  assert.equal(verifyBillingSignature(body, signature, secret), true)
  assert.equal(verifyBillingSignature(`${body} `, signature, secret), false)
  assert.equal(verifyBillingSignature(body, signature, 'different-secret'), false)
})

test('malformed billing signatures fail without throwing', () => {
  assert.equal(verifyBillingSignature('{}', null, 'secret'), false)
  assert.equal(verifyBillingSignature('{}', 'sha256=not-hex', 'secret'), false)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { subscriptionCycle } from '@/lib/billing/stripe-events'

const at = (iso: string) => Date.parse(iso) / 1000
const subscription = (
  interval: string,
  cancel: { cancel_at?: number; cancel_at_period_end?: boolean } = {}
) => ({
  cancel_at: cancel.cancel_at ?? null,
  cancel_at_period_end: cancel.cancel_at_period_end ?? false,
  items: {
    data: [{ current_period_end: at('2026-11-20T00:00:00Z'), price: { recurring: { interval } } }],
  },
})

test('a live subscription renews at the end of its period', () => {
  assert.deepEqual(subscriptionCycle(subscription('month')), {
    cancelsAt: null,
    interval: 'monthly',
    renewsAt: '2026-11-20T00:00:00.000Z',
  })
  assert.equal(subscriptionCycle(subscription('year'))?.interval, 'annual')
})

test('a cancelled subscription ends instead of renewing', () => {
  assert.deepEqual(subscriptionCycle(subscription('month', { cancel_at_period_end: true })), {
    cancelsAt: '2026-11-20T00:00:00.000Z',
    interval: 'monthly',
    renewsAt: null,
  })
  assert.equal(
    subscriptionCycle(subscription('year', { cancel_at: at('2026-12-01T00:00:00Z') }))?.cancelsAt,
    '2026-12-01T00:00:00.000Z'
  )
  assert.equal(
    subscriptionCycle({ cancel_at: null, cancel_at_period_end: false, items: { data: [] } }),
    null
  )
})

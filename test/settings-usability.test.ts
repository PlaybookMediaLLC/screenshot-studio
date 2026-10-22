import assert from 'node:assert/strict'
import { test } from 'node:test'
import { monthlyUsagePeriod, subscriptionPriceLabel } from '@/lib/billing/display'
import { hasPermission } from '@/lib/auth/permissions'
import { roleCapabilities } from '@/lib/auth/role-descriptions'

test('usage periods follow UTC month boundaries, including year rollover and leap years', () => {
  assert.deepEqual(monthlyUsagePeriod(new Date('2026-12-31T23:30:00-02:00')), {
    startsAt: '2027-01-01T00:00:00.000Z',
    resetsAt: '2027-02-01T00:00:00.000Z',
  })
  assert.deepEqual(monthlyUsagePeriod(new Date('2028-02-29T23:59:59Z')), {
    startsAt: '2028-02-01T00:00:00.000Z',
    resetsAt: '2028-03-01T00:00:00.000Z',
  })
})

test('plan cost uses subscription price and quantity, without inventing tiered or metered costs', () => {
  const price = { currency: 'usd', unit_amount: 4900, recurring: { interval: 'month' } }
  assert.equal(subscriptionPriceLabel([{ quantity: 2, price }]), '$98.00 / month')
  assert.equal(
    subscriptionPriceLabel([
      { price: { ...price, unit_amount: 49000, recurring: { interval: 'year' } } },
    ]),
    '$490.00 / year'
  )
  assert.equal(
    subscriptionPriceLabel([{ price: { ...price, currency: 'jpy', unit_amount: 500 } }]),
    '¥500 / month'
  )
  assert.equal(
    subscriptionPriceLabel([
      { price: { ...price, recurring: { interval: 'month', interval_count: 3 } } },
    ]),
    '$49.00 / 3 months'
  )
  assert.equal(subscriptionPriceLabel([{ price: { ...price, unit_amount: null } }]), null)
  assert.equal(subscriptionPriceLabel([{ price: { ...price, billing_scheme: 'tiered' } }]), null)
  assert.equal(
    subscriptionPriceLabel([
      { price: { ...price, recurring: { interval: 'month', usage_type: 'metered' } } },
    ]),
    null
  )
  assert.equal(subscriptionPriceLabel([{ price }, { price }]), null)
  assert.equal(subscriptionPriceLabel([]), null)
})

test('role matrix distinguishes drafting, approval, publishing, and administration', () => {
  const grants = (role: string) =>
    roleCapabilities
      .filter((capability) => hasPermission(role, capability.permission))
      .map((capability) => capability.label)
  assert.deepEqual(grants('creator'), ['Comment on visible drafts', 'Create drafts'])
  assert.deepEqual(grants('approver'), ['Comment on visible drafts', 'Approve'])
  assert.deepEqual(grants('publisher'), ['Comment on visible drafts', 'Publish'])
  assert.deepEqual(grants('viewer'), ['Comment on visible drafts'])
  assert.equal(grants('admin').length, 6)
})

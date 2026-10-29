import assert from 'node:assert/strict'
import test from 'node:test'
import type Stripe from 'stripe'
import { subscriptionMoves, targetPrices } from '../scripts/stripe-price-cutover'

test('the cutover charges the prices RFC 023 lists, in cents', () => {
  assert.deepEqual(targetPrices(), {
    STRIPE_PRICE_PRO_MONTHLY: { interval: 'month', unitAmount: 2_900 },
    STRIPE_PRICE_PRO_ANNUAL: { interval: 'year', unitAmount: 30_000 },
    STRIPE_PRICE_BUSINESS_MONTHLY: { interval: 'month', unitAmount: 7_900 },
    STRIPE_PRICE_BUSINESS_ANNUAL: { interval: 'year', unitAmount: 80_400 },
    STRIPE_PRICE_EXTRA_LAUNCH: { interval: null, unitAmount: 1_200 },
  })
})

test('every subscription on a replaced price moves unless it has ended', () => {
  const subscription = (id: string, status: Stripe.Subscription.Status, price: string) =>
    ({
      id,
      items: { data: [{ id: `si_${id}`, price: { id: price } }] },
      status,
    }) as unknown as Pick<Stripe.Subscription, 'id' | 'items' | 'status'>
  const moves = subscriptionMoves(
    [
      subscription('active', 'active', 'price_old_pro'),
      subscription('late', 'past_due', 'price_old_business'),
      subscription('trial', 'trialing', 'price_old_pro'),
      subscription('unpaid', 'unpaid', 'price_old_pro'),
      subscription('paused', 'paused', 'price_old_pro'),
      subscription('ended', 'canceled', 'price_old_pro'),
      subscription('expired', 'incomplete_expired', 'price_old_pro'),
      subscription('other', 'active', 'price_another_product'),
    ],
    { price_old_business: 'price_new_business', price_old_pro: 'price_new_pro' }
  )
  assert.deepEqual(moves, [
    { from: 'price_old_pro', item: 'si_active', subscription: 'active', to: 'price_new_pro' },
    { from: 'price_old_business', item: 'si_late', subscription: 'late', to: 'price_new_business' },
    { from: 'price_old_pro', item: 'si_trial', subscription: 'trial', to: 'price_new_pro' },
    { from: 'price_old_pro', item: 'si_unpaid', subscription: 'unpaid', to: 'price_new_pro' },
    { from: 'price_old_pro', item: 'si_paused', subscription: 'paused', to: 'price_new_pro' },
  ])
})

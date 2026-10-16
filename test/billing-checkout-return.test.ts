import assert from 'node:assert/strict'
import test from 'node:test'
import { checkoutReturnFor } from '@/lib/billing/stripe-events'

const session = (client_reference_id: string | null) => ({ client_reference_id })

test('a returning Checkout is refused unless it was started for the active workspace', () => {
  const paid = { plan: 'pro', status: 'active' } as const
  assert.equal(checkoutReturnFor(session('org_other'), 'org_1', paid), 'mismatch')
  assert.equal(checkoutReturnFor(session(null), 'org_1', paid), 'mismatch')
  assert.equal(checkoutReturnFor(null, 'org_1', null), 'mismatch')
})

test('a returning Checkout opens the app only once a paid plan is in good standing', () => {
  const at = (plan: 'free' | 'pro', status: 'active' | 'past_due' | 'trialing') =>
    checkoutReturnFor(session('org_1'), 'org_1', { plan, status })
  assert.equal(at('pro', 'active'), 'success')
  assert.equal(at('pro', 'trialing'), 'success')
  assert.equal(at('pro', 'past_due'), 'pending')
  assert.equal(at('free', 'active'), 'pending')
  assert.equal(checkoutReturnFor(session('org_1'), 'org_1', null), 'pending')
})

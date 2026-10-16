import type Stripe from 'stripe'
import { z } from 'zod'
import type { entitlementSyncSchema } from '@/lib/billing/entitlements'
import {
  CREDIT_PACKS,
  type checkoutPlanSchema,
  type creditPackSchema,
  workspacePlanSchema,
} from '@/lib/billing/plans'

/**
 * Pure mappings from Stripe objects to platform billing changes, kept apart
 * from the Stripe client so they can be tested without it.
 */

/** Days a past-due workspace keeps its plan while Stripe retries the card. */
const PAST_DUE_GRACE_DAYS = 14

type PlanPrices = Record<string, z.infer<typeof checkoutPlanSchema>>

const STANDING: Partial<Record<Stripe.Subscription.Status, number>> = {
  active: 2,
  past_due: 1,
  trialing: 2,
}

/**
 * The subscription that decides a workspace's plan when it has more than one:
 * a paying one over a past-due one over one that ended, then the larger plan,
 * then the newest. A subscription for a price the platform does not sell
 * never decides.
 */
export function governingSubscription(
  subscriptions: Stripe.Subscription[],
  plans: PlanPrices
): Stripe.Subscription | null {
  const rank = (subscription: Stripe.Subscription) => {
    const plan = plans[subscription.items.data[0]?.price.id ?? '']
    return [
      STANDING[subscription.status] ?? 0,
      plan ? workspacePlanSchema.options.indexOf(plan) : -1,
      subscription.created,
    ]
  }
  const sold = subscriptions.filter(
    (subscription) =>
      plans[subscription.items.data[0]?.price.id ?? ''] && subscription.status !== 'incomplete'
  )
  return (
    sold.sort((a, b) => {
      const [left, right] = [rank(a), rank(b)]
      return right[0] - left[0] || right[1] - left[1] || right[2] - left[2]
    })[0] ?? null
  )
}

/**
 * The entitlement a subscription grants, or null when it grants no change:
 * a first payment still pending, or a price this platform does not sell.
 * A subscription that ended returns the workspace to Free, keeping its data.
 */
export function entitlementForSubscription(
  subscription: Stripe.Subscription,
  event: { id: string; type: string },
  plans: PlanPrices
): Omit<z.input<typeof entitlementSyncSchema>, 'expectedVersion'> | null {
  const organizationId = subscription.metadata.organizationId
  const item = subscription.items.data[0]
  const plan = item ? plans[item.price.id] : undefined
  if (!organizationId || !plan || subscription.status === 'incomplete') return null
  const base = {
    eventId: event.id,
    eventType: event.type,
    externalCustomerId:
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    externalSubscriptionId: subscription.id,
    featureOverrides: {},
    organizationId,
    provider: 'stripe',
  }
  switch (subscription.status) {
    case 'active':
      return { ...base, plan, status: 'active' }
    case 'trialing':
      return { ...base, plan, status: 'trialing' }
    case 'past_due':
      return {
        ...base,
        graceUntil: new Date((item.current_period_start + PAST_DUE_GRACE_DAYS * 86_400) * 1000),
        plan,
        status: 'past_due',
      }
    default:
      // canceled, unpaid, paused, incomplete_expired
      return { ...base, plan: workspacePlanSchema.enum.free, status: 'active' }
  }
}

/**
 * The AI credits a paid one-time Checkout session buys, or null when it buys
 * none: unpaid, a subscription, or no pack price among its line items. The
 * session id is the grant's reference, so its completed and async-succeeded
 * events grant once between them.
 */
export function creditGrantForSession(
  session: Stripe.Checkout.Session,
  packs: Record<string, z.infer<typeof creditPackSchema>>
): { credits: number; organizationId: string; provider: string; reference: string } | null {
  const organizationId = session.client_reference_id
  if (session.mode !== 'payment' || session.payment_status !== 'paid' || !organizationId) {
    return null
  }
  const credits = (session.line_items?.data ?? []).reduce((total, item) => {
    const pack = item.price ? packs[item.price.id] : undefined
    return pack ? total + CREDIT_PACKS[pack].credits * (item.quantity ?? 1) : total
  }, 0)
  return credits > 0 ? { credits, organizationId, provider: 'stripe', reference: session.id } : null
}

/** Where a buyer returning from subscription Checkout goes next. */
export const checkoutReturnSchema = z.enum(['mismatch', 'pending', 'success'])

/**
 * The outcome of a returning subscription Checkout: `mismatch` when the
 * session is unknown or tagged with another workspace, `success` once the
 * applied entitlement is a paid plan in good standing, otherwise `pending`
 * (the webhook finishes the job).
 */
export function checkoutReturnFor(
  session: Pick<Stripe.Checkout.Session, 'client_reference_id'> | null,
  organizationId: string,
  entitlement: Pick<z.input<typeof entitlementSyncSchema>, 'plan' | 'status'> | null
): z.infer<typeof checkoutReturnSchema> {
  if (!session || session.client_reference_id !== organizationId) {
    return checkoutReturnSchema.enum.mismatch
  }
  return entitlement &&
    entitlement.plan !== workspacePlanSchema.enum.free &&
    (entitlement.status === 'active' || entitlement.status === 'trialing')
    ? checkoutReturnSchema.enum.success
    : checkoutReturnSchema.enum.pending
}

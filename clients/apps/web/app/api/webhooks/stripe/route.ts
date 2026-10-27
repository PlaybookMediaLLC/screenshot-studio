import type Stripe from 'stripe'
import { z } from 'zod'
import { stripeWebhookContract } from '@/lib/api/contracts/webhooks'
import { type Authenticate, route } from '@/lib/api/route'
import { AuthorizationError } from '@/lib/auth/access'
import { syncStripeEvent, verifyStripeEvent } from '@/lib/billing/stripe'

/** Stripe events authenticate with Stripe's signature over the exact body bytes. */
const stripeSignatureAccess: Authenticate<Stripe.Event> = async ({ raw, request }) => {
  const { body } = await raw()
  const event = verifyStripeEvent(z.string().parse(body), request.headers.get('stripe-signature'))
  if (!event) throw new AuthorizationError('Unauthorized Stripe event.', 401)
  return event
}

/** Apply a verified subscription event; the backend ignores a replayed event id. */
export const POST = route(stripeWebhookContract, {
  auth: stripeSignatureAccess,
  handler: async ({ access: event }) => syncStripeEvent(event),
})

import { NextResponse } from 'next/server'
import { completeCheckoutContract } from '@/lib/api/contracts/billing'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { getAuthBaseUrl } from '@/lib/auth/environment'
import { completeCheckout } from '@/lib/billing/stripe'
import { checkoutReturnSchema } from '@/lib/billing/stripe-events'

const NEXT_PATH = {
  [checkoutReturnSchema.enum.pending]: '/pricing?checkout=pending',
  [checkoutReturnSchema.enum.success]: '/?checkout=success',
}

/**
 * Stripe's success URL. Applies the plan the buyer just paid for, then sends
 * them into the app, or to a page that waits for the webhook when Stripe has
 * not activated the subscription yet.
 */
export const GET = route(completeCheckoutContract, {
  auth: organizationAccess('workspace:update'),
  handler: async ({ access, query }) => {
    const outcome = await completeCheckout({
      organizationId: access.organizationId,
      sessionId: query.session_id,
    })
    if (outcome === checkoutReturnSchema.enum.mismatch) {
      return errorResponse(403, 'This checkout does not belong to the active workspace.')
    }
    return NextResponse.redirect(new URL(NEXT_PATH[outcome], getAuthBaseUrl()), 303)
  },
})

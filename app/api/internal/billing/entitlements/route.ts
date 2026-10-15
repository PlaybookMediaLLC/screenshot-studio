import { z } from 'zod'
import { syncBillingEntitlementContract } from '@/lib/api/contracts/internal'
import { getPlatformApiEnvironment } from '@/lib/api/environment'
import { platformHeaders } from '@/lib/api/request-context'
import { type Authenticate, route } from '@/lib/api/route'
import { AuthorizationError } from '@/lib/auth/access'
import { entitlementSyncSchema, syncWorkspaceEntitlement } from '@/lib/billing/entitlements'
import { verifyBillingSignature } from '@/lib/billing/signature'

/** Billing events authenticate with an HMAC signature over the exact body bytes. */
const billingSignatureAccess: Authenticate<null> = async ({ raw, request }) => {
  const { body } = await raw()
  const signed = verifyBillingSignature(
    z.string().parse(body),
    request.headers.get(platformHeaders['x-screenshot-studio-signature']),
    getPlatformApiEnvironment().BILLING_ENTITLEMENT_WEBHOOK_SECRET ?? ''
  )
  if (!signed) {
    throw new AuthorizationError('Unauthorized billing event.', 401)
  }
  return null
}

/** Apply a verified billing event once per provider event id; a replay answers 200. */
export const POST = route(syncBillingEntitlementContract, {
  auth: billingSignatureAccess,
  handler: async ({ body }) =>
    syncWorkspaceEntitlement(entitlementSyncSchema.parse(JSON.parse(body))),
  status: (result) => (result.replayed ? 200 : 202),
})

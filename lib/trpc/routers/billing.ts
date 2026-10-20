import 'server-only'

import { backendSDK } from '@/lib/backend/sdk'
import { getWorkspaceQuota, type WorkspaceQuota, workspacePlanSchema } from '@/lib/billing/plans'
import { workspaceSubscriptionCycle } from '@/lib/billing/stripe'
import { consumeWorkspaceQuota, WorkspaceQuotaError } from '@/lib/tenant/entitlements'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

/** The workspace's plan, its usage against each monthly allowance, and its purchased credits. */
export const billingRouter = router({
  summary: organizationProcedure('workspace:read').query(async ({ ctx }) => {
    const sdk = backendSDK(ctx.access)
    const entitlements = await sdk.getEntitlements()
    const plan = workspacePlanSchema.catch(workspacePlanSchema.enum.free).parse(entitlements.plan)
    // An amount of 0 reads what is left; an exhausted allowance reads as 0.
    const allowance = async (quota: WorkspaceQuota) => ({
      included: getWorkspaceQuota(plan, quota),
      left: await consumeWorkspaceQuota(ctx.access, quota, 0).catch((error: unknown) => {
        if (error instanceof WorkspaceQuotaError) return 0
        throw error
      }),
    })
    // The AI credit meter answers with the monthly allowance and packs together.
    const [credits, posts, emails, cycle] = await Promise.all([
      allowance('ai:credits:monthly'),
      allowance('posts:monthly'),
      allowance('emails:monthly'),
      // A Stripe outage leaves the cycle out rather than the whole page.
      workspaceSubscriptionCycle(ctx.access.organizationId).catch((error: unknown) => {
        console.error('Stripe subscription lookup failed', error)
        return null
      }),
    ])
    const creditBalance = entitlements.creditBalance ?? 0
    // The grace date is in the owner's sensitive contract view, which needs a
    // fresh two-factor session; without one the page shows no date.
    const graceUntil =
      entitlements.status === 'past_due' && ctx.access.role === 'owner'
        ? await sdk
            .getWorkspaceEntitlement()
            .then(({ entitlement }) => entitlement.graceUntil)
            .catch(() => null)
        : null
    return {
      creditBalance,
      cycle,
      credits: { ...credits, left: Math.max(credits.left - creditBalance, 0) },
      emails,
      graceUntil,
      paid: entitlements.features['workspace:use'] === true,
      posts,
      plan,
      status: entitlements.status,
    }
  }),
})

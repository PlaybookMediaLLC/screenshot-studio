import 'server-only'

import { getRequestId, type TenantContext } from '@/lib/auth/access'
import type { getPageAccess } from '@/lib/auth/page-access'
import { getProductProfile } from '@/lib/tenant/product-profile'

/** The product step, which follows the plan step. */
export const ONBOARDING_PRODUCT_PATH = '/onboarding/product'

/**
 * Where a workspace goes once it has a plan: the product step until it has a
 * product profile, then the app. A failed read sends it to the app, so a
 * backend hiccup never strands someone who just paid.
 */
export async function pathAfterPlan(context: TenantContext): Promise<string> {
  const profile = await getProductProfile(context).catch(() => null)
  return profile ? '/' : ONBOARDING_PRODUCT_PATH
}

type PageAccess = NonNullable<Awaited<ReturnType<typeof getPageAccess>>>

/** The signed-in session, scoped to the active workspace; null without one. */
export function pageTenant(access: PageAccess, requestHeaders: Headers): TenantContext | null {
  if (!access.organization) return null
  return {
    organizationId: access.organization.id,
    principal: {
      display: access.session.user.email,
      kind: 'session',
      sessionId: access.session.session.id,
      userId: access.session.user.id,
    },
    requestId: getRequestId(requestHeaders),
  }
}

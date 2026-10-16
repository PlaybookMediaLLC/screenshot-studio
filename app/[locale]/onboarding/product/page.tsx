import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { OnboardingProduct } from '@/components/auth/OnboardingProduct'
import { ONBOARDING_STEPS, OnboardingShell } from '@/components/auth/OnboardingShell'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { getLocalizedPath, getPageAccess } from '@/lib/auth/page-access'
import { hasPermission } from '@/lib/auth/permissions'
import { ONBOARDING_PRODUCT_PATH, pageTenant } from '@/lib/onboarding/next-step'
import { getProductProfile } from '@/lib/tenant/product-profile'

export const metadata: Metadata = { title: 'Your product' }

type OnboardingProductPageProps = {
  params: Promise<{ locale: string }>
}

/**
 * The last onboarding step, after the plan: the product's URL becomes a
 * product profile, and the confirmed profile becomes the first campaign.
 * It needs a paid plan, since reading the site spends AI credits.
 */
export default async function OnboardingProductPage({ params }: OnboardingProductPageProps) {
  const [{ locale }, requestHeaders] = await Promise.all([params, headers()])
  const access = await getPageAccess(requestHeaders)
  if (!access) {
    redirect(
      getLocalizedPath(
        locale,
        `/sign-in?callbackURL=${encodeURIComponent(ONBOARDING_PRODUCT_PATH)}`
      )
    )
  }
  if (!access.hasOrganization) redirect(getLocalizedPath(locale, '/onboarding'))
  if (!access.hasPaidPlan) redirect(getLocalizedPath(locale, '/onboarding/plan'))
  const tenant = pageTenant(access, requestHeaders)
  // Only owners and admins edit the product profile; everyone else goes to the app.
  if (!tenant || !hasPermission(access.role, 'brand:manage')) {
    redirect(getLocalizedPath(locale, '/'))
  }
  const profile = await getProductProfile(tenant).catch(() => null)
  return (
    <OnboardingShell
      current={3}
      footer={
        <div className="flex flex-col gap-1">
          <span className="truncate">
            Signed in as <span className="text-neutral-300">{access.session.user.email}</span>
          </span>
          <SignOutButton className="h-auto w-fit p-0 text-xs text-neutral-400" variant="link" />
        </div>
      }
      steps={ONBOARDING_STEPS}
    >
      <OnboardingProduct
        campaignsEnabled={access.campaignWorkflowEnabled}
        initialProfile={profile}
      />
    </OnboardingShell>
  )
}

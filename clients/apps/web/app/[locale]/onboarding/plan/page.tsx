import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ONBOARDING_STEPS, OnboardingShell } from '@/components/auth/OnboardingShell'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { PlanCards } from '@/components/platform-landing/pricing'
import { getLocalizedPath, getPageAccess } from '@/lib/auth/page-access'
import { pageTenant, pathAfterPlan } from '@/lib/onboarding/next-step'

export const metadata: Metadata = { title: 'Choose a plan' }

type OnboardingPlanPageProps = {
  params: Promise<{ locale: string }>
}

/** A new workspace chooses a plan before continuing; there is no free plan. */
export default async function OnboardingPlanPage({ params }: OnboardingPlanPageProps) {
  const [{ locale }, requestHeaders] = await Promise.all([params, headers()])
  const access = await getPageAccess(requestHeaders)
  if (!access) {
    redirect(
      getLocalizedPath(locale, `/sign-in?callbackURL=${encodeURIComponent('/onboarding/plan')}`)
    )
  }
  if (!access.hasOrganization) redirect(getLocalizedPath(locale, '/onboarding'))
  if (access.hasPaidPlan) {
    const tenant = pageTenant(access, requestHeaders)
    redirect(getLocalizedPath(locale, tenant ? await pathAfterPlan(tenant) : '/'))
  }
  return (
    <OnboardingShell
      current={2}
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
      <div className="flex flex-1 flex-col gap-8 px-6 py-10">
        <div>
          <h1 className="text-xl font-medium text-white">Choose a plan</h1>
          <p className="mt-1.5 text-neutral-400">
            Pick Pro or Business to start using Shots. Change or cancel any time.
          </p>
        </div>
        <PlanCards location="onboarding_plan" withExtras={false} />
      </div>
    </OnboardingShell>
  )
}

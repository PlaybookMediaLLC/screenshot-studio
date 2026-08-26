import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth/AuthShell'
import { OnboardingForm } from '@/components/auth/OnboardingForm'
import { getLocalizedPath, getPageAccess } from '@/lib/auth/page-access'

type OnboardingPageProps = {
  params: Promise<{ locale: string }>
}

export default async function OnboardingPage({ params }: OnboardingPageProps) {
  const [{ locale }, requestHeaders] = await Promise.all([params, headers()])
  const access = await getPageAccess(requestHeaders)
  if (!access) redirect(getLocalizedPath(locale, '/sign-in'))
  return (
    <AuthShell
      description="Set up the shared home for your team and brand."
      title="Create your workspace"
    >
      <OnboardingForm />
    </AuthShell>
  )
}

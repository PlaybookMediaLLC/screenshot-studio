import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth/AuthShell'
import { OnboardingForm } from '@/components/auth/OnboardingForm'
import { SignOutButton } from '@/components/auth/SignOutButton'
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
      description="A shared home for your team's brand, assets, and campaigns."
      eyebrow="Step 2 of 2"
      footer={
        <div className="flex items-center gap-1">
          <span>
            Signed in as <span className="text-foreground">{access.session.user.email}</span>
          </span>
          <span aria-hidden>·</span>
          <SignOutButton className="h-auto p-0 text-xs" variant="link" />
        </div>
      }
      title="Create your workspace"
    >
      <OnboardingForm />
    </AuthShell>
  )
}

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppHeader } from '@/components/workspace/AppHeader'
import { WorkspaceActivity } from '@/components/workspace/WorkspaceActivity'
import { getLocalizedPath, getPageAccess } from '@/lib/auth/page-access'

export const metadata: Metadata = { title: 'Activity | Screenshot Studio' }

type ActivityPageProps = {
  params: Promise<{ locale: string }>
}

export default async function ActivityPage({ params }: ActivityPageProps) {
  const [{ locale }, requestHeaders] = await Promise.all([params, headers()])
  const access = await getPageAccess(requestHeaders)
  if (!access) redirect(getLocalizedPath(locale, '/sign-in'))
  if (!access.hasOrganization || !access.organization) {
    redirect(getLocalizedPath(locale, '/onboarding'))
  }
  if (!access.isWorkspaceOperational) redirect(getLocalizedPath(locale, '/workspace'))

  return (
    <>
      <AppHeader current="/activity" orgName={access.organization.name} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Releases, campaigns, announcements, and scheduled posts in this workspace.
          </p>
        </header>
        <WorkspaceActivity />
      </main>
    </>
  )
}

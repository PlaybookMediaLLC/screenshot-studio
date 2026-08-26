import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppHeader } from '@/components/workspace/AppHeader'
import { WorkspaceAssets } from '@/components/workspace/WorkspaceAssets'
import { getLocalizedPath, getPageAccess } from '@/lib/auth/page-access'

export const metadata: Metadata = { title: 'Assets | Screenshot Studio' }

type AssetsPageProps = {
  params: Promise<{ locale: string }>
}

export default async function AssetsPage({ params }: AssetsPageProps) {
  const [{ locale }, requestHeaders] = await Promise.all([params, headers()])
  const access = await getPageAccess(requestHeaders)
  if (!access) redirect(getLocalizedPath(locale, '/sign-in'))
  if (!access.hasOrganization || !access.organization) {
    redirect(getLocalizedPath(locale, '/onboarding'))
  }
  if (!access.isWorkspaceOperational) redirect(getLocalizedPath(locale, '/workspace'))

  return (
    <>
      <AppHeader current="/assets" orgName={access.organization.name} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Screenshots and video your team has saved from the editor.
          </p>
        </header>
        <WorkspaceAssets />
      </main>
    </>
  )
}

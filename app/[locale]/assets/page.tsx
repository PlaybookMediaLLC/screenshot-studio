import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
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

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Screenshots and video your team has saved from the editor.
          </p>
        </div>
        <Link
          className="text-sm font-medium underline underline-offset-4"
          href={getLocalizedPath(locale, '/')}
        >
          Open editor
        </Link>
      </header>
      <WorkspaceAssets />
    </main>
  )
}

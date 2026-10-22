import { ReturnToWork } from '@/components/platform-hub/ReturnToWork'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { LinkPreviewApp } from '@/components/link-preview/LinkPreviewApp'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { Page } from '@/components/platform-ui'
import { getLocalizedPath, getPageAccess } from '@/lib/auth/page-access'

export const metadata: Metadata = { title: 'Link preview', robots: { index: false } }

type LinkPreviewPageProps = {
  params: Promise<{ locale: string }>
}

export default async function LinkPreviewPage({ params }: LinkPreviewPageProps) {
  const [{ locale }, requestHeaders] = await Promise.all([params, headers()])
  const access = await getPageAccess(requestHeaders)
  if (!access) redirect(getLocalizedPath(locale, '/sign-in'))
  if (!access.hasOrganization || !access.organization) {
    redirect(getLocalizedPath(locale, '/onboarding'))
  }
  if (!access.isWorkspaceOperational) redirect(getLocalizedPath(locale, '/workspace'))

  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <Page
        description="See how a link unfurls on 13 platforms, fix what breaks it, make its preview image, and share it with tracked links."
        title="Link checks"
      >
        <ReturnToWork />
        <LinkPreviewApp />
      </Page>
    </PlatformShell>
  )
}

import { ReturnToWork } from '@/components/platform-hub/ReturnToWork'
import { AreaNavigation } from '@/components/platform-hub/AreaNavigation'
import { publishLinks } from '@/lib/platform/navigation'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { LinkPreviewApp } from '@/components/link-preview/LinkPreviewApp'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { Page } from '@/components/platform-ui'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { getLocalizedPath, getPageAccess } from '@/lib/auth/page-access'

export const metadata: Metadata = { title: 'Link checks', robots: { index: false } }

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
        {contentDraftsEnabled() ? <AreaNavigation items={publishLinks()} label="Publish" /> : null}
        <ReturnToWork />
        <LinkPreviewApp />
      </Page>
    </PlatformShell>
  )
}

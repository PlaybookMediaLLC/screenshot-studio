import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { Page } from '@/components/platform-ui'
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
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <Page
        actions={<ButtonLink href="/">Open editor</ButtonLink>}
        description="Screenshots and video your team has saved from the editor."
        title="Assets"
      >
        <WorkspaceAssets />
      </Page>
    </PlatformShell>
  )
}

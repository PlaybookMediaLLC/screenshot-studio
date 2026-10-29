import type { Metadata } from 'next'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { Page } from '@/components/platform-ui'
import { AreaNavigation, AUTOMATE_LINKS } from '@/components/platform-hub/AreaNavigation'
import { FrontendDeployments } from '@/components/workflows/FrontendDeployments'
import { requireWorkflowPageAccess } from '../page-access'

export const metadata: Metadata = { title: 'Production deployments' }

export default async function DeploymentPage({ params }: { params: Promise<{ locale: string }> }) {
  const access = await requireWorkflowPageAccess((await params).locale)
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <Page
        title="Production deployments"
        description="Choose your production evidence, require checks, and inspect each decision."
      >
        <AreaNavigation label="Automate" items={AUTOMATE_LINKS} />
        <FrontendDeployments canManage={access.canManage} key={access.organization.id} />
      </Page>
    </PlatformShell>
  )
}

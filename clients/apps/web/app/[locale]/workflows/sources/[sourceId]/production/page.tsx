import type { Metadata } from 'next'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { Page } from '@/components/platform-ui'
import { GitHubProduction } from '@/components/workflows/GitHubProduction'
import { requireWorkflowPageAccess } from '../../../page-access'

export const metadata: Metadata = { title: 'GitHub production evidence' }

export default async function ProductionPage({ params }: { params: Promise<{ locale: string; sourceId: string }> }) {
  const { locale, sourceId } = await params
  const access = await requireWorkflowPageAccess(locale)
  return <PlatformShell campaignsEnabled={access.campaignWorkflowEnabled} organizationName={access.organization.name}>
    <Page title="Production evidence" description="Choose the GitHub evidence your workspace accepts, then inspect every decision.">
      <GitHubProduction sourceId={sourceId} canManage={access.canManage} key={`${access.organization.id}:${sourceId}`} />
    </Page>
  </PlatformShell>
}

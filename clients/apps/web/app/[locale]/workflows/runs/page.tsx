import { AreaNavigation, AUTOMATE_LINKS } from '@/components/platform-hub/AreaNavigation'
import type { Metadata } from 'next'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { Page } from '@/components/platform-ui'
import { WorkflowRuns } from '@/components/workflows/WorkflowRuns'
import { requireWorkflowPageAccess } from '../page-access'

export const metadata: Metadata = { title: 'Workflow runs' }

type WorkflowRunsPageProps = { params: Promise<{ locale: string }> }

export default async function WorkflowRunsPage({ params }: WorkflowRunsPageProps) {
  const access = await requireWorkflowPageAccess((await params).locale)
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <Page
        actions={
          <ButtonLink href="/workflows" variant="outline">
            All workflows
          </ButtonLink>
        }
        description="Every accepted repository event and what each workflow did with it, read from persisted history."
        title="Run history"
      >
        <AreaNavigation label="Automate" items={AUTOMATE_LINKS} />
        <WorkflowRuns key={access.organization.id} />
      </Page>
    </PlatformShell>
  )
}

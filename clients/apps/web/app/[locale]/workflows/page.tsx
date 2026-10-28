import { ReturnToWork } from '@/components/platform-hub/ReturnToWork'
import { AreaNavigation, AUTOMATE_LINKS } from '@/components/platform-hub/AreaNavigation'
import type { Metadata } from 'next'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { Page } from '@/components/platform-ui'
import { WorkflowsDashboard } from '@/components/workflows/WorkflowsDashboard'
import { requireWorkflowPageAccess } from './page-access'

export const metadata: Metadata = { title: 'Workflows' }

type WorkflowsPageProps = { params: Promise<{ locale: string }> }

export default async function WorkflowsPage({ params }: WorkflowsPageProps) {
  const access = await requireWorkflowPageAccess((await params).locale)
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <Page
        actions={
          <>
            <ButtonLink href="/workflows/runs" variant="outline">
              Run history
            </ButtonLink>
            {access.canManage ? <ButtonLink href="/workflows/new">New workflow</ButtonLink> : null}
          </>
        }
        description="Shipped changes become reviewable campaigns."
        title="Automate"
      >
        <ReturnToWork />
        {access.hasPaidPlan ? null : (
          // Open on free basic scheduling, but its runs create releases and campaigns.
          <Alert>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>
                You can build workflows on free basic scheduling. Running them creates releases and
                campaign drafts, which need Pro.
              </span>
              <ButtonLink href="/upgrade?from=%2Fworkflows" size="sm">
                See plans
              </ButtonLink>
            </AlertDescription>
          </Alert>
        )}
        <AreaNavigation label="Automate" items={AUTOMATE_LINKS} />
        <WorkflowsDashboard canManage={access.canManage} key={access.organization.id} />
      </Page>
    </PlatformShell>
  )
}

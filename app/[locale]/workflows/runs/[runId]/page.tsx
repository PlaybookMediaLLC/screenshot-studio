import type { Metadata } from 'next'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { WorkflowRunDetail } from '@/components/workflows/WorkflowRunDetail'
import { requireWorkflowPageAccess } from '../../page-access'

export const metadata: Metadata = { title: 'Workflow run' }

type WorkflowRunPageProps = { params: Promise<{ locale: string; runId: string }> }

export default async function WorkflowRunPage({ params }: WorkflowRunPageProps) {
  const { locale, runId } = await params
  const access = await requireWorkflowPageAccess(locale)
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <WorkflowRunDetail
        canManage={access.canManage}
        id={runId}
        key={`${access.organization.id}:${runId}`}
      />
    </PlatformShell>
  )
}

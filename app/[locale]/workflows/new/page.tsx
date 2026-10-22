import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { WorkflowTemplates } from '@/components/workflows/WorkflowTemplates'
import { getLocalizedPath } from '@/lib/auth/page-access'
import { requireWorkflowPageAccess } from '../page-access'

export const metadata: Metadata = { title: 'New workflow' }

type NewWorkflowPageProps = { params: Promise<{ locale: string }> }

export default async function NewWorkflowPage({ params }: NewWorkflowPageProps) {
  const { locale } = await params
  const access = await requireWorkflowPageAccess(locale)
  if (!access.canManage) redirect(getLocalizedPath(locale, '/workflows'))
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <WorkflowTemplates key={access.organization.id} />
    </PlatformShell>
  )
}

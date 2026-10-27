import type { Metadata } from 'next'
import { AnalyzeWorkspace } from '@/components/analyze/AnalyzeWorkspace'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { socialSetSchema } from '@/lib/api/contracts/social-sets'
import { hasPermission } from '@/lib/auth/permissions'
import { listSocialSets } from '@/lib/tenant/write'
import { requireDraftsPageAccess } from '../../drafts/page-access'

export const metadata: Metadata = { title: 'Analyze' }

export default async function AnalyzePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { locale } = await params
  const access = await requireDraftsPageAccess(locale, '/write/analyze')
  const sets = await listSocialSets(access.tenant)
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <AnalyzeWorkspace
        sets={sets.map((s) => socialSetSchema.parse(s))}
        campaignsEnabled={access.campaignWorkflowEnabled && access.hasPaidPlan}
        canManage={hasPermission(access.role, 'publish:manage')}
        initial={await searchParams}
      />
    </PlatformShell>
  )
}

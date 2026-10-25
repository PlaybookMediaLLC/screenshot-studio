import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { WriteFrame } from '@/components/write/WriteFrame'
import { SocialAnalytics } from '@/components/write/analytics'
import { hasPermission } from '@/lib/auth/permissions'
import { backendSDK } from '@/lib/backend/sdk'
import { requireDraftsPageAccess } from '../../drafts/page-access'
import { loadWrite } from '../write-data'
import { analyticsRange } from '@/lib/write/analytics'

export const metadata = { title: 'Social analytics' }

/** Analyze provider observations for a social set the signed-in member may see. */
export default async function AnalyzePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { locale } = await params
  const access = await requireDraftsPageAccess(locale, '/write/analyze')
  const query = await searchParams
  const data = await loadWrite(access.tenant, query)
  let range = analyticsRange()
  let rangeError: string | undefined
  try {
    range = analyticsRange(query.from, query.to)
  } catch (error) {
    rangeError = error instanceof Error ? error.message : 'Choose valid dates.'
  }
  const observations =
    data.activeSet && !rangeError
      ? await backendSDK(access.tenant).listSocialAnalytics({
          socialSetId: data.activeSet.id,
          from: range.from,
          to: range.to,
        })
      : { items: [] }
  const recommendations = data.activeSet
    ? await backendSDK(access.tenant).bestPostingTimes(data.activeSet.id)
    : { items: [] }
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <WriteFrame
        activeId="analyze"
        data={data}
        campaignsEnabled={access.campaignWorkflowEnabled}
        canEdit={hasPermission(access.role, 'artifact:edit')}
        canManageSets={hasPermission(access.role, 'workspace:update')}
        canPublish={hasPermission(access.role, 'publish:manage')}
        canReview={hasPermission(access.role, 'release:approve')}
      >
        <SocialAnalytics
          observations={observations.items}
          recommendations={recommendations.items}
          timeZone={data.activeSet?.timeZone}
          canManage={hasPermission(access.role, 'connection:manage')}
          range={range}
          rangeError={rangeError}
          socialSetId={data.activeSet?.id}
        />
      </WriteFrame>
    </PlatformShell>
  )
}

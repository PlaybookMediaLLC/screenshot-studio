import type { Metadata } from 'next'
import { DraftCalendar } from '@/components/drafts/DraftCalendar'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { WriteFrame } from '@/components/write/WriteFrame'
import { calendarPostSchema } from '@/lib/api/contracts/content-draft-platform'
import { hasPermission } from '@/lib/auth/permissions'
import { backendSDK, orNull } from '@/lib/backend/sdk'
import { draftPlainText } from '@/lib/content-drafts/serialize'
import { weekStartDaySchema } from '@/lib/settings/appearance'
import { addDays, dayOfWeek, zonedDayKey, zonedInstant } from '@/lib/settings/zoned-time'
import { listContentDraftPostsBetween } from '@/lib/tenant/content-drafts'
import { listPlannedContentDrafts } from '@/lib/tenant/write'
import { requireDraftsPageAccess } from '../../drafts/page-access'
import { loadWrite } from '../write-data'

export const metadata: Metadata = { title: 'Plan' }

type PlanPageProps = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

/** Plan: a week of the active set's scheduled posts and planned drafts. */
export default async function WritePlanPage({ params, searchParams }: PlanPageProps) {
  const { locale } = await params
  const query = await searchParams
  const access = await requireDraftsPageAccess(locale, '/write/plan')
  const canManageSets = hasPermission(access.role, 'workspace:update')
  const [data, preferences] = await Promise.all([
    loadWrite(access.tenant, query),
    orNull(backendSDK(access.tenant).getUserPreferences()),
  ])
  // The plan is the set's: its days are days in the set's scheduling zone
  // (RFC 043), starting on the weekday the person chose.
  const zone = data.activeSet?.timeZone ?? 'UTC'
  const week = query.week
  const asked = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : zonedDayKey(new Date(), zone)
  const first = weekStartDaySchema.parse(preferences?.weekStart ?? 'monday')
  const start = addDays(asked, -((dayOfWeek(asked) - first + 7) % 7))
  const from = zonedInstant(start, 0, 0, zone)
  const end = zonedInstant(addDays(start, 7), 0, 0, zone)
  const [posts, planned] = await Promise.all([
    listContentDraftPostsBetween(access.tenant, from, end, data.activeSet?.id),
    listPlannedContentDrafts(access.tenant, from, end, data.activeSet?.id),
  ])
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <WriteFrame
        activeId="plan"
        canEdit={hasPermission(access.role, 'artifact:edit')}
        canManageSets={canManageSets}
        canPublish={hasPermission(access.role, 'publish:manage')}
        data={data}
      >
        <DraftCalendar
          canMove={hasPermission(access.role, 'publish:manage')}
          planned={planned.flatMap((draft) =>
            draft.plannedFor
              ? [
                  {
                    at: draft.plannedFor.toISOString(),
                    caption: (draft.plainText || draftPlainText(draft.body)).slice(0, 180),
                    draftId: draft.id,
                    title: draft.title,
                  },
                ]
              : []
          )}
          posts={posts.map((post) => calendarPostSchema.parse(post))}
          socialSetId={data.activeSet?.id}
          timeZone={zone}
          weekStart={start}
        />
      </WriteFrame>
    </PlatformShell>
  )
}

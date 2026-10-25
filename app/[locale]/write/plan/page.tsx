import type { Metadata } from 'next'
import { DraftCalendar } from '@/components/drafts/DraftCalendar'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { WriteFrame } from '@/components/write/WriteFrame'
import { calendarPostSchema } from '@/lib/api/contracts/content-draft-platform'
import { hasPermission } from '@/lib/auth/permissions'
import { backendSDK, orNull } from '@/lib/backend/sdk'
import { draftPlainText } from '@/lib/content-drafts/serialize'
import { weekStartDaySchema } from '@/lib/settings/appearance'
import { zonedDayKey, zonedInstant } from '@/lib/settings/zoned-time'
import { listContentDraftPostsBetween } from '@/lib/tenant/content-drafts'
import { listPlannedContentDrafts, listDraftTags } from '@/lib/tenant/write'
import { requireDraftsPageAccess } from '../../drafts/page-access'
import { calendarRange } from '@/lib/write/calendar'
import { loadWrite } from '../write-data'

export const metadata: Metadata = { title: 'Calendar' }

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
  let asked = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : zonedDayKey(new Date(), zone)
  const first = weekStartDaySchema.parse(preferences?.weekStart ?? 'monday')
  const view = query.view === 'month' ? 'month' : query.view === 'queue' ? 'queue' : 'week'
  let range
  try {
    range = calendarRange(asked, view, first)
  } catch {
    asked = zonedDayKey(new Date(), zone)
    range = calendarRange(asked, view, first)
  }
  const start = range.start
  const scope = query.all === 'true' ? undefined : data.activeSet?.id
  const from = zonedInstant(start, 0, 0, zone)
  const end = zonedInstant(range.end, 0, 0, zone)
  const [posts, planned, calendarTags] = await Promise.all([
    listContentDraftPostsBetween(access.tenant, from, end, scope),
    listPlannedContentDrafts(access.tenant, from, end, scope),
    query.all === 'true' && data.experiments.tags
      ? Promise.all(data.sets.map((set) => listDraftTags(access.tenant, set.id))).then((groups) =>
          groups.flatMap((group) => group ?? [])
        )
      : Promise.resolve(data.tags),
  ])
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <WriteFrame
        campaignsEnabled={access.campaignWorkflowEnabled}
        activeId="plan"
        canEdit={hasPermission(access.role, 'artifact:edit')}
        canManageSets={canManageSets}
        canPublish={hasPermission(access.role, 'publish:manage')}
        canReview={hasPermission(access.role, 'release:approve')}
        data={data}
      >
        <DraftCalendar
          view={view}
          anchor={asked}
          daysCount={range.days}
          allSets={query.all === 'true'}
          socialSets={data.sets.map((set) => ({
            id: set.id,
            name: set.name,
            platforms: set.accounts.map((account) => account.platform),
          }))}
          tags={calendarTags.map((tag) => ({
            id: tag.id,
            name: tag.name,
            socialSetId: tag.socialSetId,
          }))}
          canPlan={hasPermission(access.role, 'artifact:edit')}
          postingSlots={query.all === 'true' ? [] : (data.activeSet?.postingSlots ?? [])}
          canMove={hasPermission(access.role, 'publish:manage')}
          planned={planned.flatMap((draft) =>
            draft.plannedFor
              ? [
                  {
                    at: draft.plannedFor.toISOString(),
                    caption: (draft.plainText || draftPlainText(draft.body)).slice(0, 180),
                    draftId: draft.id,
                    socialSetId: draft.socialSetId ?? undefined,
                    tagIds: draft.tagIds,
                    platforms: data.sets.flatMap((set) =>
                      set.accounts
                        .filter((account) => draft.channelConnectionIds.includes(account.id))
                        .map((account) => account.platform)
                    ),
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

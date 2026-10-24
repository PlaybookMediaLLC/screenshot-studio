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
import { listDraftTags, listPlannedContentDrafts } from '@/lib/tenant/write'
import { requireDraftsPageAccess } from '../../drafts/page-access'
import { loadWrite } from '../write-data'
import { calendarRange } from '@/lib/write/calendar'

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
  // (RFC 024), starting on the weekday the person chose.
  const zone = data.activeSet?.timeZone ?? 'UTC'
  const week = query.week
  const asked = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : zonedDayKey(new Date(), zone)
  const first = weekStartDaySchema.parse(preferences?.weekStart ?? 'monday')
  const view = query.view === 'month' || query.view === 'queue' ? query.view : 'week'
  const range = calendarRange(asked, view, first)
  const start = range.start
  const setId = query.scope === 'workspace' ? undefined : data.activeSet?.id
  const from = zonedInstant(start, 0, 0, zone)
  const end = zonedInstant(range.end, 0, 0, zone)
  const [posts, planned, tags] = await Promise.all([
    listContentDraftPostsBetween(access.tenant, from, end, setId),
    listPlannedContentDrafts(access.tenant, from, end, setId),
    data.experiments.tags
      ? Promise.all(
          data.sets
            .filter((set) => !setId || set.id === setId)
            .map((set) => listDraftTags(access.tenant, set.id))
        ).then((groups) => groups.flat())
      : Promise.resolve([]),
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
          dayCount={range.days}
          workspaceScope={query.scope === 'workspace'}
          sets={data.sets.map((set) => ({ id: set.id, name: set.name }))}
          tags={tags.flatMap((tag) =>
            tag ? [{ id: tag.id, name: tag.name, color: tag.color }] : []
          )}
          canPlan={hasPermission(access.role, 'artifact:edit')}
          postingSlots={data.activeSet?.postingSlots ?? []}
          canMove={hasPermission(access.role, 'publish:manage')}
          planned={planned.flatMap((draft) =>
            draft.plannedFor
              ? [
                  {
                    at: draft.plannedFor.toISOString(),
                    caption: (draft.plainText || draftPlainText(draft.body)).slice(0, 180),
                    draftId: draft.id,
                    title: draft.title,
                    tagIds: draft.tagIds,
                    socialSetId: draft.socialSetId,
                    platform: draft.primaryPlatform,
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

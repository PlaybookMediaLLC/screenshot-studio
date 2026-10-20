import type { Metadata } from 'next'
import { DraftCalendar } from '@/components/drafts/DraftCalendar'
import { DraftsFrame } from '@/components/drafts/DraftsRail'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { hasPermission } from '@/lib/auth/permissions'
import { weekStartDaySchema } from '@/lib/settings/appearance'
import { addDays, dayOfWeek, zonedDayKey, zonedInstant } from '@/lib/settings/zoned-time'
import { listContentDraftPostsBetween, listContentDrafts } from '@/lib/tenant/content-drafts'
import {
  draftListItems,
  draftQueue,
  railSets,
  readPreferences,
  requireDraftsPageAccess,
  selectSocialSet,
} from '../page-access'

export const metadata: Metadata = { title: 'Drafts calendar' }

type CalendarPageProps = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ socialSet?: string; week?: string }>
}

export default async function DraftsCalendarPage({ params, searchParams }: CalendarPageProps) {
  const { locale } = await params
  const { socialSet, week } = await searchParams
  const access = await requireDraftsPageAccess(locale, '/drafts/calendar')
  const [{ selected, sets }, preferences] = await Promise.all([
    selectSocialSet(access.tenant, socialSet),
    readPreferences(access.tenant),
  ])
  // The calendar is the set's: its days are days in the set's scheduling zone,
  // starting on the weekday the person chose. Stored instants never move.
  const zone = selected?.timeZone ?? 'UTC'
  const setId = selected?.id ?? ''
  const asked = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : zonedDayKey(new Date(), zone)
  const first = weekStartDaySchema.parse(preferences?.weekStart ?? 'monday')
  const start = addDays(asked, -((dayOfWeek(asked) - first + 7) % 7))
  const from = zonedInstant(start, 0, 0, zone)
  const end = zonedInstant(addDays(start, 7), 0, 0, zone)
  const [page, queue, posts] = await Promise.all([
    listContentDrafts(access.tenant, { limit: 100, ...(setId ? { socialSetId: setId } : {}) }),
    draftQueue(access.tenant, setId),
    listContentDraftPostsBetween(access.tenant, from, end, setId),
  ])

  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <DraftsFrame
        activeId="calendar"
        canEdit={hasPermission(access.role, 'artifact:edit')}
        drafts={draftListItems(page.items)}
        queue={queue}
        selectedSet={selected?.id}
        sets={railSets(sets)}
      >
        <DraftCalendar
          canMove={hasPermission(access.role, 'publish:manage')}
          posts={posts.map((post) => ({
            ...post,
            createdAt: post.createdAt.toISOString(),
            metricsAt: post.metricsAt?.toISOString() ?? null,
            scheduledFor: post.scheduledFor.toISOString(),
            slotAt: post.slotAt?.toISOString() ?? null,
          }))}
          planned={page.items.flatMap((draft) =>
            draft.plannedFor && draft.status !== 'archived'
              ? [{ id: draft.id, plannedFor: draft.plannedFor, title: draft.title }]
              : []
          )}
          socialSetId={selected?.id}
          timeZone={zone}
          weekStart={start}
        />
      </DraftsFrame>
    </PlatformShell>
  )
}

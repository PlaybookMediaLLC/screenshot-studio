import type { Metadata } from 'next'
import { DraftCalendar } from '@/components/drafts/DraftCalendar'
import { DraftsFrame } from '@/components/drafts/DraftsRail'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { hasPermission } from '@/lib/auth/permissions'
import { listContentDraftPostsBetween, listContentDrafts } from '@/lib/tenant/content-drafts'
import { draftListItems, draftQueue, requireDraftsPageAccess } from '../page-access'

export const metadata: Metadata = { title: 'Drafts calendar' }

type CalendarPageProps = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ week?: string }>
}

/** The Monday on or before `date`, at midnight. */
function weekStart(date: Date): Date {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start
}

export default async function DraftsCalendarPage({ params, searchParams }: CalendarPageProps) {
  const { locale } = await params
  const { week } = await searchParams
  const access = await requireDraftsPageAccess(locale, '/drafts/calendar')
  const asked = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? new Date(`${week}T00:00:00`) : new Date()
  const start = weekStart(Number.isNaN(asked.getTime()) ? new Date() : asked)
  // The browser lays the week out in its own time zone, which can sit a day
  // either side of this server's, so fetch a day of slack each way; the
  // calendar places each post on its local day.
  const from = new Date(start)
  from.setDate(start.getDate() - 1)
  const end = new Date(start)
  end.setDate(start.getDate() + 8)
  const [page, queue, posts] = await Promise.all([
    listContentDrafts(access.tenant, { limit: 100 }),
    draftQueue(access.tenant),
    listContentDraftPostsBetween(access.tenant, from, end),
  ])
  const day = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

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
          weekStart={day(start)}
        />
      </DraftsFrame>
    </PlatformShell>
  )
}

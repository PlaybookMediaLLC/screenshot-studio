import type { Metadata } from 'next'
import { DraftCalendar } from '@/components/drafts/DraftCalendar'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { WriteFrame } from '@/components/write/WriteFrame'
import { calendarPostSchema } from '@/lib/api/contracts/content-draft-platform'
import { hasPermission } from '@/lib/auth/permissions'
import { draftPlainText } from '@/lib/content-drafts/serialize'
import { listContentDraftPostsBetween } from '@/lib/tenant/content-drafts'
import { listPlannedContentDrafts } from '@/lib/tenant/write'
import { requireDraftsPageAccess } from '../../drafts/page-access'
import { loadWrite } from '../write-data'

export const metadata: Metadata = { title: 'Plan' }

type PlanPageProps = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

/** The Monday on or before `date`, at midnight. */
function weekStart(date: Date): Date {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start
}

/** Plan: a week of the active set's scheduled posts and planned drafts. */
export default async function WritePlanPage({ params, searchParams }: PlanPageProps) {
  const { locale } = await params
  const query = await searchParams
  const access = await requireDraftsPageAccess(locale, '/write/plan')
  const canManageSets = hasPermission(access.role, 'workspace:update')
  const week = query.week
  const asked = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? new Date(`${week}T00:00:00`) : new Date()
  const start = weekStart(Number.isNaN(asked.getTime()) ? new Date() : asked)
  // The browser lays the week out in its own time zone, which can sit a day
  // either side of this server's, so fetch a day of slack each way; the
  // calendar places each post on its local day.
  const from = new Date(start)
  from.setDate(start.getDate() - 1)
  const end = new Date(start)
  end.setDate(start.getDate() + 8)
  const data = await loadWrite(access.tenant, query, { connections: canManageSets })
  const [posts, planned] = await Promise.all([
    listContentDraftPostsBetween(access.tenant, from, end, data.activeSet?.id),
    listPlannedContentDrafts(access.tenant, from, end, data.activeSet?.id),
  ])
  const day = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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
          weekStart={day(start)}
        />
      </WriteFrame>
    </PlatformShell>
  )
}

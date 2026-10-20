import type { Metadata } from 'next'
import { DraftsFrame } from '@/components/drafts/DraftsRail'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { hasPermission } from '@/lib/auth/permissions'
import { listContentDrafts } from '@/lib/tenant/content-drafts'
import { draftListItems, draftQueue, railSets, requireDraftsPageAccess, selectSocialSet } from './page-access'

export const metadata: Metadata = { title: 'Drafts' }

type DraftsPageProps = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ socialSet?: string }>
}

export default async function DraftsPage({ params, searchParams }: DraftsPageProps) {
  const { locale } = await params
  const access = await requireDraftsPageAccess(locale, '/drafts')
  const { selected, sets } = await selectSocialSet(access.tenant, (await searchParams).socialSet)
  const setId = selected?.id ?? ''
  const [page, queue] = await Promise.all([
    listContentDrafts(access.tenant, { limit: 100, ...(setId ? { socialSetId: setId } : {}) }),
    draftQueue(access.tenant, setId),
  ])

  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <DraftsFrame
        canEdit={hasPermission(access.role, 'artifact:edit')}
        drafts={draftListItems(page.items)}
        queue={queue}
        selectedSet={selected?.id}
        sets={railSets(sets)}
      >
        <div className="flex h-full items-center justify-center p-8 text-center">
          <div>
            <p className="text-sm text-foreground/80">Write it once, post it everywhere.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Open a draft on the left, or start a new one.
            </p>
          </div>
        </div>
      </DraftsFrame>
    </PlatformShell>
  )
}

import type { Metadata } from 'next'
import { DraftsFrame } from '@/components/drafts/DraftsRail'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { hasPermission } from '@/lib/auth/permissions'
import { listContentDrafts } from '@/lib/tenant/content-drafts'
import { draftListItems, requireDraftsPageAccess } from './page-access'

export const metadata: Metadata = { title: 'Drafts' }

type DraftsPageProps = {
  params: Promise<{ locale: string }>
}

export default async function DraftsPage({ params }: DraftsPageProps) {
  const { locale } = await params
  const access = await requireDraftsPageAccess(locale, '/drafts')
  const page = await listContentDrafts(access.tenant, { limit: 100 })

  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <DraftsFrame
        canEdit={hasPermission(access.role, 'artifact:edit')}
        drafts={draftListItems(page.items)}
      >
        <div className="flex h-full items-center justify-center p-8 text-center">
          <div>
            <p className="text-sm text-neutral-300">Write it once, post it everywhere.</p>
            <p className="mt-1 text-xs text-neutral-500">
              Open a draft on the left, or start a new one.
            </p>
          </div>
        </div>
      </DraftsFrame>
    </PlatformShell>
  )
}

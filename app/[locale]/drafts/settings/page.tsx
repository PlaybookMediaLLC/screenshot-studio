import type { Metadata } from 'next'
import { DraftSettingsForm } from '@/components/drafts/DraftSettingsForm'
import { DraftsFrame } from '@/components/drafts/DraftsRail'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { hasPermission } from '@/lib/auth/permissions'
import { getContentDraftSettings, listContentDrafts } from '@/lib/tenant/content-drafts'
import { draftListItems, draftQueue, requireDraftsPageAccess } from '../page-access'

export const metadata: Metadata = { title: 'Drafts settings' }

type SettingsPageProps = { params: Promise<{ locale: string }> }

export default async function DraftsSettingsPage({ params }: SettingsPageProps) {
  const { locale } = await params
  const access = await requireDraftsPageAccess(locale, '/drafts/settings')
  const [page, queue, settings] = await Promise.all([
    listContentDrafts(access.tenant, { limit: 100 }),
    draftQueue(access.tenant),
    getContentDraftSettings(access.tenant),
  ])

  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <DraftsFrame
        activeId="settings"
        canEdit={hasPermission(access.role, 'artifact:edit')}
        drafts={draftListItems(page.items)}
        queue={queue}
      >
        <DraftSettingsForm
          canManage={hasPermission(access.role, 'publish:manage')}
          settings={settings}
        />
      </DraftsFrame>
    </PlatformShell>
  )
}

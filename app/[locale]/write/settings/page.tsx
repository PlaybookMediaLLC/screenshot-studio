import type { Metadata } from 'next'
import { DraftSettingsForm } from '@/components/drafts/DraftSettingsForm'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { WriteFrame } from '@/components/write/WriteFrame'
import { hasPermission } from '@/lib/auth/permissions'
import { getContentDraftSettings } from '@/lib/tenant/content-drafts'
import { requireDraftsPageAccess } from '../../drafts/page-access'
import { loadWrite } from '../write-data'

export const metadata: Metadata = { title: 'Write settings' }

type SettingsPageProps = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

/** Write's workspace settings: approval before publishing. */
export default async function WriteSettingsPage({ params, searchParams }: SettingsPageProps) {
  const { locale } = await params
  const access = await requireDraftsPageAccess(locale, '/write/settings')
  const canManageSets = hasPermission(access.role, 'workspace:update')
  const data = await loadWrite(access.tenant, await searchParams)
  const settings = await getContentDraftSettings(access.tenant)
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <WriteFrame
        campaignsEnabled={access.campaignWorkflowEnabled}
        activeId="settings"
        canEdit={hasPermission(access.role, 'artifact:edit')}
        canManageSets={canManageSets}
        canPublish={hasPermission(access.role, 'publish:manage')}
        canReview={hasPermission(access.role, 'release:approve')}
        data={data}
      >
        <DraftSettingsForm
          canManage={hasPermission(access.role, 'publish:manage')}
          settings={settings}
        />
      </WriteFrame>
    </PlatformShell>
  )
}

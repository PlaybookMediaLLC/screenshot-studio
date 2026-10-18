import type { Metadata } from 'next'
import { DraftList } from '@/components/drafts/DraftList'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { Page } from '@/components/platform-ui'
import { hasPermission } from '@/lib/auth/permissions'
import { draftPlainText } from '@/lib/content-drafts/serialize'
import { listContentDrafts } from '@/lib/tenant/content-drafts'
import { requireDraftsPageAccess } from './page-access'

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
      <Page description="Posts you write by hand, then schedule to your channels." title="Drafts">
        <DraftList
          canEdit={hasPermission(access.role, 'artifact:edit')}
          drafts={page.items.map((draft) => ({
            excerpt: (draft.plainText || draftPlainText(draft.body)).slice(0, 160),
            id: draft.id,
            status: draft.status,
            title: draft.title,
            updatedAt: draft.updatedAt.toISOString(),
          }))}
        />
      </Page>
    </PlatformShell>
  )
}

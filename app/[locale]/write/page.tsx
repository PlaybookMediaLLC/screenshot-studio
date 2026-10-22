import type { Metadata } from 'next'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { NewDraftMenu } from '@/components/write/library'
import { WriteFrame } from '@/components/write/WriteFrame'
import { hasPermission } from '@/lib/auth/permissions'
import { requireDraftsPageAccess } from '../drafts/page-access'
import { loadWrite } from './write-data'

export const metadata: Metadata = { title: 'Write' }

type WritePageProps = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

/** Write: the social set's library, with nothing open yet. */
export default async function WritePage({ params, searchParams }: WritePageProps) {
  const { locale } = await params
  const access = await requireDraftsPageAccess(locale, '/write')
  const canManageSets = hasPermission(access.role, 'workspace:update')
  const data = await loadWrite(access.tenant, await searchParams)
  const canEdit = hasPermission(access.role, 'artifact:edit')
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <WriteFrame
        campaignsEnabled={access.campaignWorkflowEnabled}
        canEdit={canEdit}
        canManageSets={canManageSets}
        canPublish={hasPermission(access.role, 'publish:manage')}
        canReview={hasPermission(access.role, 'release:approve')}
        data={data}
      >
        <div className="flex h-full items-center justify-center p-8 text-center">
          <div className="max-w-sm">
            <p className="text-sm text-neutral-300">
              Write it once, adapt it per platform, publish when it is right.
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Open a draft on the left, or start a new one in {data.activeSet?.name ?? 'this set'}.
            </p>
            {canEdit ? (
              <div className="mt-4 flex justify-center">
                <NewDraftMenu compact />
              </div>
            ) : null}
          </div>
        </div>
      </WriteFrame>
    </PlatformShell>
  )
}

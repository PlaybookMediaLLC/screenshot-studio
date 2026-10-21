import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { WriteComposer } from '@/components/write/composer/WriteComposer'
import { WriteFrame } from '@/components/write/WriteFrame'
import { contentDraftPostSchema, contentDraftSchema } from '@/lib/api/contracts/content-drafts'
import { hasPermission } from '@/lib/auth/permissions'
import {
  getContentDraft,
  getContentDraftSettings,
  listContentDraftPosts,
} from '@/lib/tenant/content-drafts'
import { isAiEnabled } from '@/lib/trpc/routers/launch'
import { requireDraftsPageAccess } from '../../drafts/page-access'
import { loadWrite } from '../write-data'

export const metadata: Metadata = { title: 'Write' }

type WriteDraftPageProps = {
  params: Promise<{ draftId: string; locale: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

/** Write with a draft open: the library of the draft's set beside the composer. */
export default async function WriteDraftPage({ params, searchParams }: WriteDraftPageProps) {
  const { draftId, locale } = await params
  const access = await requireDraftsPageAccess(locale, `/write/${draftId}`)
  const draft = await getContentDraft(access.tenant, draftId)
  if (!draft) notFound()
  const canManageSets = hasPermission(access.role, 'workspace:update')
  const [data, posts, aiEnabled, settings] = await Promise.all([
    // The library shows the set the draft belongs to, whatever was open before.
    loadWrite(access.tenant, { ...(await searchParams), set: draft.socialSetId ?? undefined }),
    listContentDraftPosts(access.tenant, draftId),
    isAiEnabled(access.tenant).catch(() => false),
    getContentDraftSettings(access.tenant),
  ])
  const canEdit = hasPermission(access.role, 'artifact:edit')
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <WriteFrame
        activeId={draft.id}
        canEdit={canEdit}
        canManageSets={canManageSets}
        canPublish={hasPermission(access.role, 'publish:manage')}
        canReview={hasPermission(access.role, 'release:approve')}
        data={data}
      >
        <WriteComposer
          aiEnabled={aiEnabled}
          // Real-time co-editing runs when the collaboration server is configured.
          collabUrl={process.env.PLATFORM_COLLAB_URL || null}
          draft={contentDraftSchema.parse(draft)}
          key={draft.id}
          posts={(posts ?? []).map((post) => contentDraftPostSchema.parse(post))}
          requireApproval={settings.requireApproval}
          set={data.activeSet}
          user={{ id: access.session.user.id, name: access.session.user.name }}
          vocabulary={data.vocabulary}
        />
      </WriteFrame>
    </PlatformShell>
  )
}

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DraftComposer } from '@/components/drafts/DraftComposer'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { hasPermission } from '@/lib/auth/permissions'
import { channelForPlatform } from '@/lib/content-drafts/serialize'
import { getContentDraft, listContentDraftPosts } from '@/lib/tenant/content-drafts'
import { listBackendConnections } from '@/lib/tenant/publishing-backend'
import { isAiEnabled } from '@/lib/trpc/routers/launch'
import { requireDraftsPageAccess } from '../page-access'

export const metadata: Metadata = { title: 'Draft' }

type DraftPageProps = {
  params: Promise<{ draftId: string; locale: string }>
}

export default async function DraftPage({ params }: DraftPageProps) {
  const { draftId, locale } = await params
  const access = await requireDraftsPageAccess(locale, `/drafts/${draftId}`)
  const canSchedule = hasPermission(access.role, 'publish:manage')
  const [draft, posts, connections, aiEnabled] = await Promise.all([
    getContentDraft(access.tenant, draftId),
    listContentDraftPosts(access.tenant, draftId),
    // Channel connections are a publishing surface: only publishers see them.
    canSchedule ? listBackendConnections(access.tenant) : Promise.resolve([]),
    isAiEnabled(access.tenant).catch(() => false),
  ])
  if (!draft) notFound()

  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <DraftComposer
        aiEnabled={aiEnabled}
        canEdit={hasPermission(access.role, 'artifact:edit')}
        canSchedule={canSchedule}
        // Real-time co-editing runs when the collaboration server is configured.
        collabUrl={process.env.PLATFORM_COLLAB_URL || null}
        channels={connections.flatMap((connection) => {
          const channel = channelForPlatform(connection.platform)
          return connection.status === 'ACTIVE' && channel
            ? [{ channel, id: connection.id, name: connection.externalAccountId }]
            : []
        })}
        draft={{
          assetIds: draft.assetIds,
          body: draft.body,
          channelConnectionIds: draft.channelConnectionIds,
          id: draft.id,
          status: draft.status,
          title: draft.title,
          version: draft.version,
        }}
        posts={(posts ?? []).map((post) => ({
          ...post,
          createdAt: post.createdAt.toISOString(),
          scheduledFor: post.scheduledFor.toISOString(),
        }))}
        user={{ id: access.session.user.id, name: access.session.user.name }}
      />
    </PlatformShell>
  )
}

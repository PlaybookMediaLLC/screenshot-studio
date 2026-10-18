import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DraftComposer } from '@/components/drafts/DraftComposer'
import { DraftsFrame } from '@/components/drafts/DraftsRail'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { hasPermission } from '@/lib/auth/permissions'
import { channelForPlatform } from '@/lib/content-drafts/serialize'
import { draftVocabulary } from '@/lib/content-drafts/vocabulary'
import {
  getContentDraft,
  getContentDraftSettings,
  listContentDraftPosts,
  listContentDrafts,
} from '@/lib/tenant/content-drafts'
import { listBackendConnections } from '@/lib/tenant/publishing-backend'
import { isAiEnabled } from '@/lib/trpc/routers/launch'
import { draftListItems, draftQueue, requireDraftsPageAccess } from '../page-access'

export const metadata: Metadata = { title: 'Draft' }

type DraftPageProps = {
  params: Promise<{ draftId: string; locale: string }>
}

export default async function DraftPage({ params }: DraftPageProps) {
  const { draftId, locale } = await params
  const access = await requireDraftsPageAccess(locale, `/drafts/${draftId}`)
  const canSchedule = hasPermission(access.role, 'publish:manage')
  const canEdit = hasPermission(access.role, 'artifact:edit')
  const [draft, posts, connections, aiEnabled, list, settings, queue] = await Promise.all([
    getContentDraft(access.tenant, draftId),
    listContentDraftPosts(access.tenant, draftId),
    // Channel connections are a publishing surface: only publishers see them.
    canSchedule ? listBackendConnections(access.tenant) : Promise.resolve([]),
    isAiEnabled(access.tenant).catch(() => false),
    listContentDrafts(access.tenant, { limit: 100 }),
    getContentDraftSettings(access.tenant),
    draftQueue(access.tenant),
  ])
  if (!draft) notFound()

  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <DraftsFrame
        activeId={draft.id}
        canEdit={canEdit}
        drafts={draftListItems(list.items)}
        queue={queue}
      >
        <DraftComposer
          aiEnabled={aiEnabled}
          author={access.organization.name}
          vocabulary={draftVocabulary(list.items.map((item) => item.plainText))}
          canEdit={canEdit}
          canSchedule={canSchedule}
          // Real-time co-editing runs when the collaboration server is configured.
          collabUrl={process.env.PLATFORM_COLLAB_URL || null}
          channels={connections.flatMap((connection) => {
            const channel = channelForPlatform(connection.platform)
            return connection.status === 'ACTIVE' && channel
              ? [
                  {
                    avatarUrl: connection.avatarUrl ?? null,
                    channel,
                    handle: connection.handle ?? null,
                    id: connection.id,
                    name:
                      connection.displayName || connection.handle || connection.externalAccountId,
                  },
                ]
              : []
          })}
          draft={{
            assetIds: draft.assetIds,
            body: draft.body,
            channelConnectionIds: draft.channelConnectionIds,
            channelText: draft.channelText,
            discussions: draft.discussions,
            id: draft.id,
            status: draft.status,
            title: draft.title,
            version: draft.version,
            approvedVersion: draft.approvedVersion,
            reviewNote: draft.reviewNote,
            reviewStatus: draft.reviewStatus,
            shareToken: draft.shareToken,
            guestComments: draft.guestComments.map((comment) => ({
              ...comment,
              createdAt: comment.createdAt.toISOString(),
            })),
          }}
          requireApproval={settings.requireApproval}
          posts={(posts ?? []).map((post) => ({
            ...post,
            createdAt: post.createdAt.toISOString(),
            metricsAt: post.metricsAt?.toISOString() ?? null,
            scheduledFor: post.scheduledFor.toISOString(),
          }))}
          user={{ id: access.session.user.id, name: access.session.user.name }}
        />
      </DraftsFrame>
    </PlatformShell>
  )
}

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
import { draftListItems, draftQueue, railSets, requireDraftsPageAccess, selectSocialSet } from '../page-access'

export const metadata: Metadata = { title: 'Draft' }

type DraftPageProps = {
  params: Promise<{ draftId: string; locale: string }>
}

export default async function DraftPage({ params }: DraftPageProps) {
  const { draftId, locale } = await params
  const access = await requireDraftsPageAccess(locale, `/drafts/${draftId}`)
  const canSchedule = hasPermission(access.role, 'publish:manage')
  const canEdit = hasPermission(access.role, 'artifact:edit')
  const draft = await getContentDraft(access.tenant, draftId)
  if (!draft) notFound()
  // The draft's own set is the context: its accounts, queue and voice (RFC 043).
  const { selected, sets } = await selectSocialSet(access.tenant, draft.socialSetId ?? undefined)
  const set = draft.socialSetId ? sets.find((item) => item.id === draft.socialSetId) : undefined
  const setId = set?.id ?? ''
  const [posts, connections, aiEnabled, list, settings, queue] = await Promise.all([
    listContentDraftPosts(access.tenant, draftId),
    // Channel connections are a publishing surface: only publishers see them.
    canSchedule && !set ? listBackendConnections(access.tenant) : Promise.resolve([]),
    isAiEnabled(access.tenant).catch(() => false),
    listContentDrafts(access.tenant, { limit: 100, ...(setId ? { socialSetId: setId } : {}) }),
    getContentDraftSettings(access.tenant),
    draftQueue(access.tenant, setId),
  ])
  // A set's accounts with their health; a draft from before sets uses every connection.
  const channels = set
    ? canSchedule
      ? set.accounts.flatMap((account) => {
          const channel = channelForPlatform(account.platform)
          return channel
            ? [
                {
                  avatarUrl: account.avatarUrl,
                  channel,
                  handle: account.handle,
                  health: account.health,
                  id: account.id,
                  name: account.displayName || account.handle || account.platform,
                },
              ]
            : []
        })
      : []
    : connections.flatMap((connection) => {
        const channel = channelForPlatform(connection.platform)
        return connection.status === 'ACTIVE' && channel
          ? [
              {
                avatarUrl: connection.avatarUrl ?? null,
                channel,
                handle: connection.handle ?? null,
                id: connection.id,
                name: connection.displayName || connection.handle || connection.externalAccountId,
              },
            ]
          : []
      })

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
        selectedSet={set?.id ?? selected?.id}
        sets={railSets(sets)}
      >
        <DraftComposer
          aiEnabled={aiEnabled}
          author={access.organization.name}
          vocabulary={draftVocabulary(list.items.map((item) => item.plainText))}
          canEdit={canEdit}
          canSchedule={canSchedule}
          // Real-time co-editing runs when the collaboration server is configured.
          collabUrl={process.env.PLATFORM_COLLAB_URL || null}
          channels={channels}
          socialSet={set ? { id: set.id, name: set.name, timeZone: set.timeZone } : null}
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
            engagement: draft.engagement,
            naturalPostingTime: draft.naturalPostingTime,
            plannedFor: draft.plannedFor,
            primaryPlatform: draft.primaryPlatform,
            socialSetId: draft.socialSetId,
            tags: draft.tags,
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
            slotAt: post.slotAt?.toISOString() ?? null,
          }))}
          user={{ id: access.session.user.id, name: access.session.user.name }}
        />
      </DraftsFrame>
    </PlatformShell>
  )
}

import 'server-only'

import type {
  BackendAutoActions,
  BackendContentDraft,
  BackendContentDraftPost,
  BackendContentDraftCreate,
  BackendContentDraftListQuery,
  BackendContentDraftUpdate,
  BackendPoll,
  BackendSharedContentDraft,
} from 'screenshot-studio-backend-sdk'
import type { OrganizationAccess, TenantContext } from '@/lib/auth/access'
import { backendSDK, orNull, serviceBackend, withDates } from '@/lib/backend/sdk'
import { channelForPlatform, serializeDraft } from '@/lib/content-drafts/serialize'
import { listBackendConnections } from '@/lib/tenant/publishing-backend'
import { ScheduledPostError } from '@/lib/tenant/scheduled-posts'

/**
 * Content drafts for a workspace (RFC 037). The backend scopes every query to
 * the workspace, checks roles, the plan, and that attached assets and channels
 * are the workspace's, and refuses an update based on an older version with a
 * 409.
 */

/** Dates for the draft's own timestamps; the Plate body passes through as is. */
function readDraft(draft: BackendContentDraft) {
  const { body, ...fields } = draft
  return { ...withDates(fields), body: body as Record<string, unknown>[] }
}

/** One page of the workspace's drafts, newest first. */
export async function listContentDrafts(
  context: TenantContext,
  query: BackendContentDraftListQuery
) {
  const page = await backendSDK(context).listContentDrafts(query)
  return { items: page.items.map(readDraft), nextCursor: page.nextCursor }
}

/** Create a draft. */
export async function createContentDraft(context: TenantContext, input: BackendContentDraftCreate) {
  return readDraft(await backendSDK(context).createContentDraft(input))
}

/** A draft of this workspace, or null. */
export async function getContentDraft(context: TenantContext, id: string) {
  const draft = await orNull(backendSDK(context).getContentDraft(id))
  return draft ? readDraft(draft) : null
}

/** Update a draft based on `baseVersion`; null when it is not in this workspace. */
export async function updateContentDraft(
  context: TenantContext,
  id: string,
  input: BackendContentDraftUpdate
) {
  const draft = await orNull(backendSDK(context).updateContentDraft(id, input))
  return draft ? readDraft(draft) : null
}

/** Delete a draft; false when it is not in this workspace. */
export async function deleteContentDraft(context: TenantContext, id: string) {
  return (await orNull(backendSDK(context).deleteContentDraft(id))) !== null
}

/** A draft's post with its times as Dates. */
function readPost(post: BackendContentDraftPost) {
  return { ...withDates(post), scheduledFor: new Date(post.scheduledFor) }
}

/** Every post scheduled from a draft; null when it is not in this workspace. */
export async function listContentDraftPosts(context: TenantContext, id: string) {
  const result = await orNull(backendSDK(context).listContentDraftPosts(id))
  return result ? result.posts.map(readPost) : null
}

/**
 * Schedule the draft to channels. Each caption is serialized here from the
 * stored draft, with the same function the composer previews with, and a
 * caption a channel cannot take is refused before anything is queued. Each
 * post's images are the draft's, in body order, with rendered table and math
 * blocks among them; the backend checks they are the workspace's.
 */
export async function scheduleContentDraft(
  context: OrganizationAccess,
  id: string,
  input: {
    blockImages?: (string | null)[]
    channelConnectionIds: string[]
    /** Per channel: X follow-ups and a poll. */
    options?: Record<string, { autoActions?: BackendAutoActions; poll?: BackendPoll }>
    /** When set, the queue's next free slot instead of `scheduledFor`. */
    queue?: boolean
    /** Overrides the draft's natural posting time for this schedule. */
    naturalPostingTime?: boolean
    scheduledFor?: Date
    version: number
  }
) {
  const draft = await getContentDraft(context, id)
  if (!draft) return null
  // The backend picks and reserves a queued slot inside the scheduling
  // transaction, so two requests cannot take the same one.
  if (!input.queue && !input.scheduledFor)
    throw new ScheduledPostError('Pick a time, or add the draft to the queue.', 400)
  const platforms = new Map(
    (await listBackendConnections(context)).map((connection) => [
      connection.id,
      connection.platform,
    ])
  )
  const targets = input.channelConnectionIds.map((channelConnectionId) => {
    const platform = platforms.get(channelConnectionId)
    const channel = platform ? channelForPlatform(platform) : null
    if (!channel) throw new ScheduledPostError('A selected channel cannot take this draft.', 404)
    const serialized = serializeDraft(
      draft.body,
      channel,
      input.blockImages,
      draft.channelText[channel]
    )
    if (serialized.errors.length > 0) {
      throw new ScheduledPostError(`${channel}: ${serialized.errors.join(' ')}`, 409)
    }
    // A thread channel posts the first post, then the rest as replies; every
    // other channel gets the whole draft as its one post.
    const [first, ...replies] = serialized.posts
    return {
      assetIds: first?.assetIds ?? [],
      caption: first?.caption ?? '',
      channelConnectionId,
      ...(replies.length > 0
        ? { replies: replies.map(({ assetIds, caption }) => ({ assetIds, caption })) }
        : {}),
      ...input.options?.[channelConnectionId],
    }
  })
  const result = await backendSDK(context).scheduleContentDraft(id, {
    ...(input.naturalPostingTime === undefined
      ? {}
      : { naturalPostingTime: input.naturalPostingTime }),
    ...(input.queue ? { queue: true } : { scheduledFor: input.scheduledFor }),
    targets,
    version: input.version,
  })
  return {
    created: result.created,
    draft: readDraft(result.draft),
    posts: result.posts.map(readPost),
  }
}

/** A collaboration token for the draft; null when it is not in this workspace. */
export async function createContentDraftCollabToken(context: OrganizationAccess, id: string) {
  const token = await orNull(backendSDK(context).createContentDraftCollabToken(id))
  return token ? withDates(token) : null
}

/** The workspace's drafts settings: queue slots and approvals. */
export async function getContentDraftSettings(context: TenantContext) {
  return backendSDK(context).getContentDraftSettings()
}

/** Save the drafts settings an owner, admin or publisher sets. */
export async function updateContentDraftSettings(
  context: TenantContext,
  input: { postingSlots?: { time: string; weekday: number }[]; requireApproval?: boolean }
) {
  return backendSDK(context).updateContentDraftSettings(input)
}

/** Suggested posting times, from the workspace's engagement. */
export async function bestPostingTimes(context: TenantContext, socialSetId = '') {
  const { items } = await backendSDK(context).bestPostingTimes(socialSetId)
  return items.map((item) => ({ ...item, at: new Date(item.at) }))
}

/** The queue's next free slot. */
export async function nextQueueSlot(context: TenantContext, socialSetId = '') {
  return new Date((await backendSDK(context).nextContentDraftQueueSlot(socialSetId)).scheduledFor)
}

/** Draft posts due in [from, to), with their drafts' titles. */
export async function listContentDraftPostsBetween(
  context: TenantContext,
  from: Date,
  to: Date,
  socialSetId = ''
) {
  const { items } = await backendSDK(context).listContentDraftPostsBetween(from, to, socialSetId)
  return items.map((post) => ({
    ...readPost(post),
    draftId: post.draftId,
    draftTitle: post.draftTitle,
  }))
}

/** Move one queued post; null when it is not in this workspace. */
export async function moveContentDraftPost(context: TenantContext, id: string, scheduledFor: Date) {
  const result = await orNull(backendSDK(context).moveContentDraftPost(id, scheduledFor))
  return result ? readPost(result.post) : null
}

/** Post the rest of a stopped thread; null when the post is not in this workspace. */
export async function resumeContentDraftThread(context: TenantContext, id: string) {
  const result = await orNull(backendSDK(context).resumeContentDraftThread(id))
  return result ? readPost(result.post) : null
}

/** Read a live post's engagement now; null when it is not in this workspace. */
export async function refreshContentDraftPostMetrics(context: TenantContext, id: string) {
  const post = await orNull(backendSDK(context).refreshContentDraftPostMetrics(id))
  return post ? readPost(post) : null
}

/** A review step on a draft; null when it is not in this workspace. */
export async function reviewContentDraft(
  context: TenantContext,
  id: string,
  input: { action: 'request' | 'approve' | 'changes'; note?: string }
) {
  const draft = await orNull(backendSDK(context).reviewContentDraft(id, input))
  return draft ? readDraft(draft) : null
}

/** Turn a draft's guest link on or off; null when it is not in this workspace. */
export async function shareContentDraft(context: TenantContext, id: string, enabled: boolean) {
  const draft = await orNull(backendSDK(context).shareContentDraft(id, enabled))
  return draft ? readDraft(draft) : null
}

/** A draft's revisions, newest first; null when it is not in this workspace. */
export async function listContentDraftRevisions(context: TenantContext, id: string) {
  const result = await orNull(backendSDK(context).listContentDraftRevisions(id))
  // A list carries no bodies; one revision's read does.
  return result
    ? result.items.map(
        ({ createdAt, createdByUserId, id: revisionId, plainText, title, version }) => ({
          createdAt: new Date(createdAt),
          createdByUserId,
          id: revisionId,
          plainText,
          title,
          version,
        })
      )
    : null
}

/** One revision with its body. */
export async function getContentDraftRevision(
  context: TenantContext,
  id: string,
  revisionId: string
) {
  const revision = await orNull(backendSDK(context).getContentDraftRevision(id, revisionId))
  if (!revision) return null
  const { body, ...fields } = revision
  return { ...withDates(fields), body: body as Record<string, unknown>[] | undefined }
}

/** A shared draft with Dates, and its body as Plate nodes. */
function readShared(draft: BackendSharedContentDraft) {
  const { body, ...fields } = draft
  return { ...withDates(fields), body: body as Record<string, unknown>[] }
}

/** A guest's view of a shared draft; null for a link that is off or wrong. */
export async function getSharedContentDraft(token: string) {
  const draft = await orNull(serviceBackend().getSharedContentDraft(token))
  return draft ? readShared(draft) : null
}

/** Keep a guest's comment on a shared draft; null for a link that is off. */
export async function addGuestComment(token: string, input: { name: string; text: string }) {
  const draft = await orNull(serviceBackend().addGuestComment(token, input))
  return draft ? readShared(draft) : null
}

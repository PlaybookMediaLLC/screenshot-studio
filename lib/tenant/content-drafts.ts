import 'server-only'

import type {
  BackendContentDraft,
  BackendContentDraftPost,
  BackendContentDraftInput,
  BackendContentDraftListQuery,
  BackendContentDraftUpdate,
} from 'screenshot-studio-backend-sdk'
import type { OrganizationAccess, TenantContext } from '@/lib/auth/access'
import { backendSDK, orNull, withDates } from '@/lib/backend/sdk'
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
export async function createContentDraft(context: TenantContext, input: BackendContentDraftInput) {
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
    scheduledFor: Date
    version: number
  }
) {
  const draft = await getContentDraft(context, id)
  if (!draft) return null
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
    const serialized = serializeDraft(draft.body, channel, input.blockImages)
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
    }
  })
  const result = await backendSDK(context).scheduleContentDraft(id, {
    scheduledFor: input.scheduledFor,
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

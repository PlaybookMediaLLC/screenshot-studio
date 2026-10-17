import 'server-only'

import type {
  BackendContentDraft,
  BackendContentDraftInput,
  BackendContentDraftListQuery,
  BackendContentDraftUpdate,
} from 'screenshot-studio-backend-sdk'
import type { TenantContext } from '@/lib/auth/access'
import { backendSDK, orNull, withDates } from '@/lib/backend/sdk'

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

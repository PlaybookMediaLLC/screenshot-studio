import 'server-only'

import type {
  BackendDraftActivity,
  BackendDraftCopy,
  BackendDraftFinisher,
  BackendDraftTag,
  BackendSocialSet,
  BackendSocialSetInput,
} from 'screenshot-studio-backend-sdk'
import type { TenantContext } from '@/lib/auth/access'
import { backendSDK, orNull, withDates } from '@/lib/backend/sdk'
import { readDraft } from '@/lib/tenant/content-drafts'
import { tagColorSchema } from '@/lib/api/contracts/draft-tags'
import { socialSetColorSchema, socialSetVisibilitySchema } from '@/lib/api/contracts/social-sets'
import { draftChannelSchema } from '@/lib/write/document'

/**
 * The Write workspace for a workspace (RFC 041): social sets, their tags and
 * finishers, and a draft's properties, plan, copies, recovered backups and
 * activity. The backend checks roles, the plan, and set visibility on every
 * call; a set or draft the caller may not see reads as missing (null).
 */

/** A social set with Dates, its closed values parsed at this boundary. */
function readSet(set: BackendSocialSet) {
  return {
    ...withDates(set),
    color: socialSetColorSchema.parse(set.color),
    connections: set.connections.map((connection) => ({
      ...connection,
      channel: draftChannelSchema.parse(connection.channel),
    })),
    defaultChannels: set.defaultChannels.map((channel) => draftChannelSchema.parse(channel)),
    visibility: socialSetVisibilitySchema.parse(set.visibility),
  }
}

/** The social sets the caller may see, the default first. */
export async function listSocialSets(context: TenantContext) {
  return (await backendSDK(context).listSocialSets()).items.map(readSet)
}

/** One social set, or null. */
export async function getSocialSet(context: TenantContext, id: string) {
  const set = await orNull(backendSDK(context).getSocialSet(id))
  return set ? readSet(set) : null
}

/** Create a social set. */
export async function createSocialSet(
  context: TenantContext,
  input: BackendSocialSetInput & { name: string }
) {
  return readSet(await backendSDK(context).createSocialSet(input))
}

/** Change a social set; null when it is not visible. */
export async function updateSocialSet(
  context: TenantContext,
  id: string,
  input: BackendSocialSetInput
) {
  const set = await orNull(backendSDK(context).updateSocialSet(id, input))
  return set ? readSet(set) : null
}

/** Delete an empty social set; false when it is not visible. */
export async function deleteSocialSet(context: TenantContext, id: string) {
  return (await orNull(backendSDK(context).deleteSocialSet(id))) !== null
}

/** A tag with Dates and its colour parsed. */
function readTag(tag: BackendDraftTag) {
  return { ...withDates(tag), color: tagColorSchema.parse(tag.color) }
}

/** A set's tags; null when the set is not visible. */
export async function listDraftTags(context: TenantContext, setId: string) {
  const result = await orNull(backendSDK(context).listDraftTags(setId))
  return result ? result.items.map(readTag) : null
}

/** Add a tag to a set; null when the set is not visible. */
export async function createDraftTag(
  context: TenantContext,
  setId: string,
  input: { color?: string; name: string }
) {
  const tag = await orNull(backendSDK(context).createDraftTag(setId, input))
  return tag ? readTag(tag) : null
}

/** Rename or recolour a tag; null when it is not visible. */
export async function updateDraftTag(
  context: TenantContext,
  setId: string,
  tagId: string,
  input: { color?: string; name?: string }
) {
  const tag = await orNull(backendSDK(context).updateDraftTag(setId, tagId, input))
  return tag ? readTag(tag) : null
}

/** Delete a tag; false when it is not visible. */
export async function deleteDraftTag(context: TenantContext, setId: string, tagId: string) {
  return (await orNull(backendSDK(context).deleteDraftTag(setId, tagId))) !== null
}

/** A finisher with Dates. */
function readFinisher(finisher: BackendDraftFinisher) {
  return withDates(finisher)
}

/** A set's thread finishers; null when the set is not visible. */
export async function listDraftFinishers(context: TenantContext, setId: string) {
  const result = await orNull(backendSDK(context).listDraftFinishers(setId))
  return result ? result.items.map(readFinisher) : null
}

/** Add a finisher; null when the set is not visible. */
export async function createDraftFinisher(
  context: TenantContext,
  setId: string,
  input: { name: string; quoteFirstPost?: boolean; text: string }
) {
  const finisher = await orNull(backendSDK(context).createDraftFinisher(setId, input))
  return finisher ? readFinisher(finisher) : null
}

/** Edit a finisher; null when it is not visible. */
export async function updateDraftFinisher(
  context: TenantContext,
  setId: string,
  finisherId: string,
  input: { name?: string; quoteFirstPost?: boolean; text?: string }
) {
  const finisher = await orNull(backendSDK(context).updateDraftFinisher(setId, finisherId, input))
  return finisher ? readFinisher(finisher) : null
}

/** Delete a finisher; false when it is not visible. */
export async function deleteDraftFinisher(
  context: TenantContext,
  setId: string,
  finisherId: string
) {
  return (await orNull(backendSDK(context).deleteDraftFinisher(setId, finisherId))) !== null
}

/** Pin, tag or annotate a draft; null when it is not visible. */
export async function updateDraftProperties(
  context: TenantContext,
  id: string,
  input: { addTagIds?: string[]; pinned?: boolean; removeTagIds?: string[]; scratchpad?: string }
) {
  const draft = await orNull(backendSDK(context).updateContentDraftProperties(id, input))
  return draft ? readDraft(draft) : null
}

/** Plan a draft, or clear its plan; null when it is not visible. */
export async function planContentDraft(
  context: TenantContext,
  id: string,
  input: { plannedFor: string | null; timeZone?: string }
) {
  const draft = await orNull(
    backendSDK(context).planContentDraft(id, {
      plannedFor: input.plannedFor ? new Date(input.plannedFor) : null,
      timeZone: input.timeZone,
    })
  )
  return draft ? readDraft(draft) : null
}

/** A copy result with its draft read. */
function readCopy(copy: BackendDraftCopy) {
  return { draft: readDraft(copy.draft), dropped: copy.dropped }
}

/** Duplicate a draft in its set; null when it is not visible. */
export async function duplicateContentDraft(context: TenantContext, id: string) {
  const copy = await orNull(backendSDK(context).duplicateContentDraft(id))
  return copy ? readCopy(copy) : null
}

/** Copy a draft into another set; null when either is not visible. */
export async function copyContentDraft(
  context: TenantContext,
  id: string,
  input: { socialSetId: string; tagMode: 'match' | 'drop' }
) {
  const copy = await orNull(backendSDK(context).copyContentDraft(id, input))
  return copy ? readCopy(copy) : null
}

/** A new draft from a backup; null when either is not visible. */
export async function recoverContentDraftRevision(
  context: TenantContext,
  id: string,
  revisionId: string
) {
  const copy = await orNull(backendSDK(context).recoverContentDraftRevision(id, revisionId))
  return copy ? readCopy(copy) : null
}

/** An activity event with its time as a Date. */
function readActivity(item: BackendDraftActivity) {
  const { at, ...fields } = item
  return { ...fields, at: new Date(at) }
}

/** A draft's history, newest first; null when it is not visible. */
export async function listContentDraftActivity(context: TenantContext, id: string) {
  const result = await orNull(backendSDK(context).listContentDraftActivity(id))
  return result ? result.items.map(readActivity) : null
}

/** Drafts planned in [from, to); one set's when given. */
export async function listPlannedContentDrafts(
  context: TenantContext,
  from: Date,
  to: Date,
  socialSetId?: string
) {
  return (await backendSDK(context).listPlannedContentDrafts(from, to, socialSetId)).items.map(
    readDraft
  )
}

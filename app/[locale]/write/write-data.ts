import 'server-only'

import { cookies } from 'next/headers'
import { z } from 'zod'
import type { OrganizationAccess } from '@/lib/auth/access'
import { backendSDK, orNull } from '@/lib/backend/sdk'
import { listContentDraftPostsBetween, listContentDrafts } from '@/lib/tenant/content-drafts'
import { listDraftTags, listPlannedContentDrafts, listSocialSets } from '@/lib/tenant/write'
import { draftKindSchema } from '@/lib/write/document'
import { contentDraftSortSchema } from '@/lib/write/wire'
import { draftPlainText } from '@/lib/content-drafts/serialize'
import { draftVocabulary } from '@/lib/content-drafts/vocabulary'
import { SOCIAL_SET_COOKIE } from '@/lib/settings/appearance'

/**
 * What every Write page loads (RFC 042): the social sets the member may see,
 * the active one, its draft library for the chosen lifecycle tab, filters
 * and order, its queue, and its tags. The active set comes from the URL,
 * then the last one chosen (a cookie), then the workspace's default set.
 */

/** The library tabs: drafts being written, the queue, what went live, the archive. */
export const writeTabSchema = z.enum(['drafts', 'queue', 'posted', 'archived'])

/** One of {@link writeTabSchema}. */
export type WriteTab = z.infer<typeof writeTabSchema>

/** The library's URL state. */
export const writeQuerySchema = z.object({
  kind: draftKindSchema.optional().catch(undefined),
  q: z.string().max(200).optional().catch(undefined),
  set: z.string().max(40).optional().catch(undefined),
  sort: contentDraftSortSchema.optional().catch(undefined),
  tab: writeTabSchema.optional().catch(undefined),
  tag: z.string().max(40).optional().catch(undefined),
})

/** One of {@link writeQuerySchema}. */
export type WriteQuery = z.infer<typeof writeQuerySchema>

/**
 * The settings platform's experiments Write follows (RFC 043): tags on drafts
 * and planning drafts on the calendar. The backend refuses both unless the
 * person turned them on and the workspace allows them.
 */
export const writeExperimentSchema = z.enum(['draft-tags', 'draft-planning'])

/** Load the library for a Write page. */
export async function loadWrite(tenant: OrganizationAccess, rawQuery: Record<string, unknown>) {
  const query = writeQuerySchema.parse(rawQuery)
  const [sets, experimentList] = await Promise.all([
    listSocialSets(tenant),
    orNull(backendSDK(tenant).listExperiments()),
  ])
  const enabled = (id: z.infer<typeof writeExperimentSchema>) =>
    experimentList?.items.some((item) => item.id === id && item.enabled) ?? false
  const experiments = { planning: enabled('draft-planning'), tags: enabled('draft-tags') }
  const remembered = (await cookies()).get(SOCIAL_SET_COOKIE)?.value
  const activeSet =
    sets.find((set) => set.id === query.set) ??
    sets.find((set) => set.id === remembered) ??
    sets.find((set) => set.visibility === 'WORKSPACE') ??
    sets[0]
  const tab: WriteTab = query.tab ?? 'drafts'
  const now = new Date()
  const horizon = new Date(now.getTime() + 60 * 86_400_000)
  const [page, posts, planned, tags] = await Promise.all([
    listContentDrafts(tenant, {
      kind: query.kind,
      limit: 100,
      search: query.q,
      socialSetId: activeSet?.id,
      sort: query.sort,
      tagId: experiments.tags ? query.tag : undefined,
      view: tab === 'queue' ? 'drafts' : tab,
    }),
    listContentDraftPostsBetween(tenant, now, horizon, activeSet?.id),
    experiments.planning
      ? listPlannedContentDrafts(tenant, now, horizon, activeSet?.id)
      : Promise.resolve([]),
    activeSet && experiments.tags ? listDraftTags(tenant, activeSet.id) : Promise.resolve([]),
  ])
  const library = [...page.pinned, ...page.items].map((draft) => ({
    attentionPosts: draft.attentionPosts,
    channelConnectionIds: draft.channelConnectionIds,
    excerpt: (draft.plainText || draftPlainText(draft.body)).slice(0, 180),
    id: draft.id,
    kind: draft.kind,
    nextPostAt: draft.nextPostAt?.toISOString() ?? null,
    pinned: draft.pinnedAt !== null,
    plannedFor: draft.plannedFor?.toISOString() ?? null,
    publishedPosts: draft.publishedPosts,
    queuedPosts: draft.queuedPosts,
    reviewStatus: draft.reviewStatus,
    shared: draft.shareToken !== null,
    status: draft.status,
    tagIds: draft.tagIds,
    title: draft.title,
    updatedAt: draft.updatedAt.toISOString(),
  }))
  const queue = [
    ...posts
      .filter((post) => post.status === 'SCHEDULED' || post.status === 'PROCESSING')
      .map((post) => ({
        at: post.scheduledFor.toISOString(),
        caption: post.caption,
        draftId: post.draftId,
        id: post.id,
        kind: 'scheduled' as const,
        platform: post.platform,
      })),
    ...planned.map((draft) => ({
      at: draft.plannedFor?.toISOString() ?? now.toISOString(),
      caption: (draft.plainText || draftPlainText(draft.body)).slice(0, 180),
      draftId: draft.id,
      id: `planned-${draft.id}`,
      kind: 'planned' as const,
      platform: draft.primaryPlatform,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  return {
    activeSet: activeSet ?? null,
    experiments,
    library,
    query: { ...query, tab },
    queue,
    sets,
    tags: (tags ?? []).map((tag) => ({ ...tag, createdAt: tag.createdAt.toISOString() })),
    vocabulary: draftVocabulary(page.items.map((draft) => draft.plainText)),
  }
}

/** The library as the Write pages hand it to the browser. */
export type WriteData = Awaited<ReturnType<typeof loadWrite>>

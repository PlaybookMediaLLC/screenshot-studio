import type { DraftWire } from '@/lib/content-drafts/client'
import { draftPlainText } from '@/lib/content-drafts/serialize'

/** The saved fields a draft contributes to the Write library. */
export function libraryDraft(draft: DraftWire) {
  const text = draft.plainText || draftPlainText(draft.body)
  return {
    attentionPosts: draft.attentionPosts,
    channelConnectionIds: draft.channelConnectionIds,
    excerpt: text.slice(0, 180),
    id: draft.id,
    searchText: `${text} ${draft.scratchpad}`,
    kind: draft.kind,
    nextPostAt: draft.nextPostAt,
    pinned: draft.pinnedAt !== null,
    plannedFor: draft.plannedFor,
    publishedPosts: draft.publishedPosts,
    queuedPosts: draft.queuedPosts,
    reviewStatus: draft.reviewStatus,
    shared: draft.shareToken !== null,
    status: draft.status,
    tagIds: draft.tagIds,
    title: draft.title,
    updatedAt: draft.updatedAt,
  }
}

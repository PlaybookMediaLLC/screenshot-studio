import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SharedDraftView } from '@/components/drafts/SharedDraftView'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { getSharedContentDraft } from '@/lib/tenant/content-drafts'

export const metadata: Metadata = { robots: { follow: false, index: false }, title: 'Shared draft' }

/** A draft shared for feedback. The link is the only credential; off, it is gone. */
export default async function SharedDraftPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!contentDraftsEnabled() || token.length < 20 || token.length > 64) notFound()
  const draft = await getSharedContentDraft(token)
  if (!draft) notFound()
  return (
    <SharedDraftView
      comments={draft.guestComments.map((comment) => ({
        ...comment,
        createdAt: comment.createdAt.toISOString(),
      }))}
      text={draft.plainText}
      title={draft.title}
      token={token}
    />
  )
}

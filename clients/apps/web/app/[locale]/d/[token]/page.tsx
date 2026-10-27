import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SharedDraftView } from '@/components/drafts/SharedDraftView'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { getSharedContentDraft } from '@/lib/tenant/content-drafts'
import { appOrigin } from '@/lib/sharing/page'

/** Metadata obeys the same share-token lookup and revocation as the page. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const base: Metadata = { robots: { follow: false, index: false }, title: 'Shared draft' }
  if (!contentDraftsEnabled() || token.length < 20 || token.length > 64) return base
  const draft = await getSharedContentDraft(token)
  if (!draft) return base
  const title = draft.title || 'Shared draft'
  const description = draft.plainText.slice(0, 200)
  const images = draft.imageAssetId ? [new URL(`/api/drafts/shared/${encodeURIComponent(token)}/image`,appOrigin()).toString()] : undefined
  return {
    ...base,
    title,
    description,
    openGraph: { title, description, images, type: 'article' },
    twitter: { card: images ? 'summary_large_image' : 'summary', title, description, images },
  }
}

/** A draft shared for feedback. The link is the only credential; off, it is gone. */
export default async function SharedDraftPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!contentDraftsEnabled() || token.length < 20 || token.length > 64) notFound()
  const draft = await getSharedContentDraft(token)
  if (!draft) notFound()
  return (
    <SharedDraftView
      published={draft.published}
      publishedUrl={draft.publishedUrl}
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

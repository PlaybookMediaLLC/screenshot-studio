import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { StoreReviewViewer } from '@/components/store-screenshots/review/StoreReviewViewer'
import { readSharedReview } from '@/lib/tenant/store-screenshots'

export const metadata: Metadata = { robots: { follow: false, index: false }, title: 'Screenshot review' }

/** A shared, read-only review of a screenshot set. The signed link is the only credential. */
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const review = await readSharedReview(token)
  if (!review) notFound()
  return <StoreReviewViewer token={token} review={review} />
}

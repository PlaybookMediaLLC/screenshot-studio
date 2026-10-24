import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AnalyzeWorkspace } from '@/components/analyze/AnalyzeWorkspace'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

export const metadata: Metadata = {
  title: 'Shared analytics',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

/** Every data request resolves the public token afresh; no report is cached in the page. */
export default async function PublicAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { token } = await params
  if (!contentDraftsEnabled() || !/^[A-Za-z0-9_-]{32}$/.test(token)) notFound()
  return <AnalyzeWorkspace publicToken={token} initial={await searchParams} />
}

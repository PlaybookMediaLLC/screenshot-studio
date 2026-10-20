import { redirect } from 'next/navigation'
import { getLocalizedPath } from '@/lib/auth/page-access'

type DraftsPageProps = {
  params: Promise<{ locale: string }>
}

/** Drafts moved to Write (RFC 042); old links keep working. */
export default async function DraftsPage({ params }: DraftsPageProps) {
  const { locale } = await params
  redirect(getLocalizedPath(locale, '/write'))
}

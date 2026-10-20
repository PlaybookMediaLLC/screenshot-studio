import { redirect } from 'next/navigation'
import { getLocalizedPath } from '@/lib/auth/page-access'

type SettingsPageProps = { params: Promise<{ locale: string }> }

/** Drafts settings moved to Write (RFC 042); old links keep working. */
export default async function DraftsSettingsPage({ params }: SettingsPageProps) {
  const { locale } = await params
  redirect(getLocalizedPath(locale, '/write/settings'))
}

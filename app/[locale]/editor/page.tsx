import { permanentRedirect } from 'next/navigation'
import { getLocalizedPath } from '@/lib/auth/page-access'

type EditorAliasPageProps = {
  params: Promise<{ locale: string }>
}

// The fork serves the signed-in editor at `/`. Upstream links point at `/editor`,
// so this route forwards them to the workspace editor.
export default async function EditorAliasPage({ params }: EditorAliasPageProps) {
  const { locale } = await params
  permanentRedirect(getLocalizedPath(locale, '/'))
}

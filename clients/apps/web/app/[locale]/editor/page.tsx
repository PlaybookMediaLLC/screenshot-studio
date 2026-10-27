import { permanentRedirect } from 'next/navigation'
import { getLocalizedPath } from '@/lib/auth/page-access'

type EditorAliasPageProps = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// The fork serves the signed-in editor at `/`. Upstream links point at `/editor`,
// so this route forwards them to the workspace editor.
export default async function EditorAliasPage({ params, searchParams }: EditorAliasPageProps) {
  const { locale } = await params
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of [value ?? []].flat()) query.append(key, item)
  }
  permanentRedirect(getLocalizedPath(locale, query.size ? `/?${query}` : '/'))
}

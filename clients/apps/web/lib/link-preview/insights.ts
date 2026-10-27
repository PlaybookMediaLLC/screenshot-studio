import type { LinkPreview } from '@/lib/api/contracts/link-preview'

/**
 * Problems only visible across many pages: the same title, description, or
 * image on several of them, which makes shares and search results blur together.
 */

const FIELDS: Array<[string, (preview: LinkPreview) => string | undefined]> = [
  ['title', (preview) => preview.ogTitle || preview.title],
  ['description', (preview) => preview.ogDescription || preview.description],
  ['image', (preview) => preview.ogImage],
]

/** Values that two or more of `pages` share, with the pages that share them. */
export function duplicateGroups(pages: Array<{ preview: LinkPreview; url: string }>) {
  return FIELDS.flatMap(([field, read]) => {
    const byValue = new Map<string, string[]>()
    for (const { preview, url } of pages) {
      const value = read(preview)?.trim()
      if (value) byValue.set(value, [...(byValue.get(value) ?? []), url])
    }
    return [...byValue]
      .filter(([, urls]) => urls.length > 1)
      .map(([value, urls]) => ({ field, urls, value }))
  })
}

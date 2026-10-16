import { z } from 'zod'
import type { LinkPreview, LinkPreviewRendered } from '@/lib/api/contracts/link-preview'

/**
 * What JavaScript changes about a page's preview tags. Facebook, X, LinkedIn,
 * Slack, and the chat apps read the HTML as served and never run scripts, so a
 * tag that only exists after JavaScript is a tag they never see.
 */

/** How JavaScript changed a tag: added it, changed its value, or removed it. */
export const scriptChangeSchema = z.enum(['added', 'changed', 'removed'])

/** One of {@link scriptChangeSchema}. */
export type ScriptChange = z.infer<typeof scriptChangeSchema>

const FIELDS: Array<[string, keyof Omit<LinkPreviewRendered, 'tagCount'>]> = [
  ['Title', 'title'],
  ['Description', 'description'],
  ['Canonical', 'canonical'],
  ['og:title', 'ogTitle'],
  ['og:description', 'ogDescription'],
  ['og:image', 'ogImage'],
  ['og:url', 'ogUrl'],
  ['og:type', 'ogType'],
  ['og:site_name', 'ogSiteName'],
  ['twitter:card', 'twitterCard'],
  ['twitter:title', 'twitterTitle'],
  ['twitter:description', 'twitterDescription'],
  ['twitter:image', 'twitterImage'],
]

const C = scriptChangeSchema.enum

/** Each preview tag that differs between the served HTML and the page after JavaScript. */
export function scriptDifferences(raw: LinkPreview, rendered: LinkPreviewRendered) {
  return FIELDS.flatMap(([label, key]) => {
    const before = raw[key]?.trim() || undefined
    const after = rendered[key]?.trim() || undefined
    if (before === after) return []
    const change = !before ? C.added : !after ? C.removed : C.changed
    return [{ after, before, change, label }]
  })
}

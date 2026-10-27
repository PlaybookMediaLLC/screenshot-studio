import { xLength } from '@/lib/content-drafts/x-length'
import twitterText from 'twitter-text'
import type { DraftChannel } from './document'

/**
 * Layout assumptions v1 (2026-10-24). Native feed algorithms are not public.
 * LinkedIn uses three rendered lines; X long posts use weighted eligibility
 * and a ten-line feed window. Browser measurement, not a character substring,
 * determines wrapping. These are simulations, not provider pixel guarantees.
 */
export const PREVIEW_GEOMETRY_VERSION = '2026-10-24.1'

/** The collapsed line window, or null for an ordinary uncollapsed post. */
export function previewLineLimit(channel: DraftChannel, caption: string): number | null {
  if (channel === 'linkedin') return 3
  if (channel === 'x' && xLength(caption) > 280) return 10
  return null
}

/** LinkedIn annotations display their label, while the provider receives its native URN. */
export function previewText(caption: string): string {
  return caption.replace(/@\[([^\]]+)\]\(urn:li:(?:organization|person):[^)]+\)/g, '$1')
}

/** X's standard weighted window, preserving entire graphemes and URL entities. */
export function xCollapsedText(caption: string): string {
  if (xLength(caption) <= 280) return caption
  const urls = twitterText.extractUrlsWithIndices(caption)
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let used = 0
  let end = 0
  for (const segment of segments.segment(caption)) {
    if (segment.index < end) continue
    const url = urls.find((entry) => entry.indices[0] === segment.index)
    const value = url ? caption.slice(url.indices[0], url.indices[1]) : segment.segment
    const weight = url ? 23 : xLength(value)
    if (used + weight > 280) break
    used += weight
    end = segment.index + value.length
  }
  return caption.slice(0, end)
}

/** Scale inside the panel without changing the browser viewport or text wrapping. */
export function previewScale(available: number, deviceWidth: number): number {
  return Math.min(1, Math.max(0, available) / deviceWidth)
}

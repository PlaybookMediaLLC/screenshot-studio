import twitterText from 'twitter-text'
import { xLength } from '@/lib/content-drafts/x-length'
import type { DraftChannel } from './document'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** A collapsed feed excerpt without cutting emoji clusters or transformed X URLs. */
export function previewExcerpt(text: string, channel: DraftChannel): string {
  if (channel === 'linkedin') {
    return [...graphemes.segment(text.split('\n').slice(0, 3).join('\n'))]
      .slice(0, 210)
      .map((s) => s.segment)
      .join('')
  }
  if (channel !== 'x' || xLength(text) <= 280) return text
  const urls = twitterText.extractUrlsWithIndices(text)
  let shown = '',
    count = 0,
    offset = 0
  const append = (part: string, weight: number) => {
    if (count + weight > 280) return false
    shown += part
    count += weight
    return true
  }
  for (const url of [
    ...urls,
    { url: '', indices: [text.length, text.length] as [number, number] },
  ]) {
    for (const { segment } of graphemes.segment(text.slice(offset, url.indices[0]))) {
      if (!append(segment, xLength(segment))) return shown
    }
    if (url.url && !append(text.slice(...url.indices), 23)) return shown
    offset = url.indices[1]
  }
  return shown
}

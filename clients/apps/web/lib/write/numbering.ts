import type { Numbering, NumberingStyle } from '@/lib/write/document'

/**
 * Thread numbering (RFC 025). Numbers are added when a version is serialized,
 * for its preview and its publication; the authored text never holds them,
 * so adding, removing or moving a post renumbers the rest.
 *
 * Policy: skipped posts get no number. The numbers run from 1 over the posts
 * that are numbered, and the total (`1/9`, `1 of 9`) counts those posts.
 */

const KEYCAPS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

/** A number in keycap emoji: 1️⃣, 🔟, and digit by digit beyond ten (1️⃣1️⃣). */
function emoji(value: number): string {
  if (value <= 10) return KEYCAPS[value]
  return [...String(value)].map((digit) => KEYCAPS[Number(digit)]).join('')
}

/** One post's label in a style: #1, 1️⃣, 1., 1/, /1, 1/9 or 1 of 9. */
export function numberLabel(style: NumberingStyle, value: number, total: number): string {
  switch (style) {
    case 'hash':
      return `#${value}`
    case 'emoji':
      return emoji(value)
    case 'dot':
      return `${value}.`
    case 'slash':
      return `${value}/`
    case 'leading':
      return `/${value}`
    case 'fraction':
      return `${value}/${total}`
    case 'of':
      return `${value} of ${total}`
  }
}

/**
 * The label each post gets, or null for a post left unnumbered. Off, or a
 * single post, numbers nothing.
 */
export function threadLabels(count: number, numbering: Numbering | undefined): (string | null)[] {
  const labels: (string | null)[] = Array.from({ length: count }, () => null)
  if (!numbering?.enabled || count < 2) return labels
  const first = Math.min(numbering.skipFirst ?? 0, count)
  const last = Math.max(first, count - (numbering.skipLast ?? 0))
  const total = last - first
  for (let index = first; index < last; index += 1) {
    labels[index] = numberLabel(numbering.style, index - first + 1, total)
  }
  return labels
}

/** A caption with its label at the start or end, on the same line as the text. */
export function withLabel(caption: string, label: string | null, numbering: Numbering): string {
  if (!label) return caption
  if (!caption) return label
  return numbering.position === 'start' ? `${label} ${caption}` : `${caption} ${label}`
}

/** Every post's caption, numbered as the version asks. */
export function numberCaptions(captions: string[], numbering: Numbering | undefined): string[] {
  const labels = threadLabels(captions.length, numbering)
  return numbering
    ? captions.map((caption, index) => withLabel(caption, labels[index], numbering))
    : captions
}

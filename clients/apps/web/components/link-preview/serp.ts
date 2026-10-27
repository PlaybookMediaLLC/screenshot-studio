/**
 * Google cuts titles and snippets by rendered width, not character count.
 * These measure text the way the results page sets it (Arial, 20 px titles,
 * 14 px snippets) and cut it where Google would.
 */

/** About how wide Google lets each part run on desktop before cutting it. */
export const SERP_LIMITS = {
  description: { font: '14px Arial, sans-serif', width: 920 },
  title: { font: '20px Arial, sans-serif', width: 580 },
} as const

let context: CanvasRenderingContext2D | null | undefined

function measure(text: string, font: string): number {
  if (typeof document === 'undefined') return 0
  context ??= document.createElement('canvas').getContext('2d')
  if (!context) return 0
  context.font = font
  return context.measureText(text).width
}

/** `text` as Google would show it, and whether it was cut. */
// ponytail: fixed desktop widths; Google varies them by device and query, so this is an estimate.
export function serpFit(text: string, part: keyof typeof SERP_LIMITS) {
  const { font, width } = SERP_LIMITS[part]
  if (measure(text, font) <= width) return { cut: false, shown: text, width: measure(text, font) }
  let shown = text
  while (shown && measure(`${shown}…`, font) > width) shown = shown.slice(0, -1)
  return { cut: true, shown: `${shown.trimEnd()} …`, width: measure(text, font) }
}

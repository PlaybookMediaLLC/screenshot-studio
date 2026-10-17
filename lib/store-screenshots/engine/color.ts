import { z } from 'zod'
import type { Background, StoreAsset } from '../document/schema'
import type { Rect } from './geometry'

/**
 * Color math for contrast-aware text. Ratios follow WCAG 2.2: 4.5:1 for body
 * text, 3:1 for large text (at least 24 px, or 18.66 px bold, at 1x).
 */

/** An sRGB color with 0-255 channels. */
export type Rgb = { r: number; g: number; b: number }

/** WCAG contrast for normal text. */
export const CONTRAST_NORMAL = 4.5
/** WCAG contrast for large text. */
export const CONTRAST_LARGE = 3

/** Parse `#RRGGBB`. Invalid input reads as black. */
export function parseHex(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) return { r: 0, g: 0, b: 0 }
  const value = Number.parseInt(match[1], 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

/** Format as `#RRGGBB`. */
export function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase()
}

/** Linear interpolation between two colors in sRGB. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

/** WCAG relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const linear = (value: number) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG contrast ratio between two colors, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Whether type counts as large text for WCAG at the given rendered size. */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700)
}

/**
 * Color of a CSS linear gradient at a point. CSS angles: 0deg points up,
 * 90deg right; the gradient line passes through the box centre and is long
 * enough for the corners to reach 0% and 100%.
 */
export function linearGradientAt(
  from: Rgb,
  to: Rgb,
  angle: number,
  box: { width: number; height: number },
  point: { x: number; y: number }
): Rgb {
  const radians = (angle * Math.PI) / 180
  const dx = Math.sin(radians)
  const dy = -Math.cos(radians)
  const length = Math.abs(box.width * dx) + Math.abs(box.height * dy)
  if (length === 0) return from
  const projected = (point.x - box.width / 2) * dx + (point.y - box.height / 2) * dy
  const t = Math.min(1, Math.max(0, projected / length + 0.5))
  return mixRgb(from, to, t)
}

/**
 * Average color of an image background at a slide point, from the asset's
 * coarse color grid. The grid is mapped through the same cover/contain fit
 * the renderer uses; points outside a contained image read the fallback.
 */
function imageColorAt(
  background: Extract<Background, { kind: 'image' }>,
  asset: StoreAsset | undefined,
  box: { width: number; height: number },
  point: { x: number; y: number }
): Rgb {
  const fallback = parseHex(background.color)
  if (!asset || asset.colorGrid.length !== GRID_COLUMNS * GRID_ROWS) return fallback
  const imageAspect = asset.width / asset.height
  const boxAspect = box.width / box.height
  const cover = background.fit === 'cover'
  const scale =
    cover === imageAspect > boxAspect ? box.height / asset.height : box.width / asset.width
  const drawnWidth = asset.width * scale
  const drawnHeight = asset.height * scale
  const left = (box.width - drawnWidth) * (background.focusX / 100)
  const top = (box.height - drawnHeight) * (background.focusY / 100)
  const u = (point.x - left) / drawnWidth
  const v = (point.y - top) / drawnHeight
  if (u < 0 || u > 1 || v < 0 || v > 1) return fallback
  const column = Math.min(GRID_COLUMNS - 1, Math.floor(u * GRID_COLUMNS))
  const row = Math.min(GRID_ROWS - 1, Math.floor(v * GRID_ROWS))
  return parseHex(asset.colorGrid[row * GRID_COLUMNS + column])
}

/** Columns in an asset color grid. */
export const GRID_COLUMNS = 4
/** Rows in an asset color grid. */
export const GRID_ROWS = 8

/**
 * Background colors behind a rectangle, sampled on a 3x3 lattice. `box` is
 * the area the background is painted over (a slide, or a whole panorama with
 * `offsetX` locating this slide inside it).
 */
export function sampleBackground(
  background: Background,
  assets: Record<string, StoreAsset>,
  box: { width: number; height: number },
  rect: Rect,
  offsetX = 0
): Rgb[] {
  const samples: Rgb[] = []
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const point = {
        x: offsetX + rect.x + (rect.width * (column + 0.5)) / 3,
        y: rect.y + (rect.height * (row + 0.5)) / 3,
      }
      samples.push(backgroundColorAt(background, assets, box, point))
    }
  }
  return samples
}

/** The background color at one point. */
export function backgroundColorAt(
  background: Background,
  assets: Record<string, StoreAsset>,
  box: { width: number; height: number },
  point: { x: number; y: number }
): Rgb {
  if (background.kind === 'solid') return parseHex(background.color)
  if (background.kind === 'linear') {
    return linearGradientAt(
      parseHex(background.from),
      parseHex(background.to),
      background.angle,
      box,
      point
    )
  }
  return imageColorAt(background, assets[background.assetId], box, point)
}

/** The lowest contrast a text color reaches against any sample. */
export function worstContrast(text: Rgb, samples: Rgb[]): number {
  return samples.reduce((worst, sample) => Math.min(worst, contrastRatio(text, sample)), 21)
}

/** Automatic text color tones: strong for headings, muted for supporting copy. */
export const textToneSchema = z.enum(['strong', 'muted'])

/** Automatic text tone. */
export type TextTone = z.infer<typeof textToneSchema>

/** Candidate colors for automatic text, light first. */
export const AUTO_TEXT_CANDIDATES: Record<TextTone, [string, string]> = {
  strong: ['#FFFFFF', '#111111'],
  muted: ['#F4F4F5', '#3F3F46'],
}

/**
 * Pick the readable color for text over the sampled background: the
 * candidate with the best worst-case contrast. Muted candidates (used for
 * subheadings) fall back to the strong pair when neither meets `minimum`.
 */
export function pickReadableColor(
  samples: Rgb[],
  tone: TextTone,
  minimum: number
): { color: string; contrast: number } {
  const rank = (candidates: readonly string[]) =>
    candidates
      .map((color) => ({ color, contrast: worstContrast(parseHex(color), samples) }))
      .sort((a, b) => b.contrast - a.contrast)[0]
  const preferred = rank(AUTO_TEXT_CANDIDATES[tone])
  if (tone === 'strong' || preferred.contrast >= minimum) return preferred
  return rank(AUTO_TEXT_CANDIDATES.strong)
}

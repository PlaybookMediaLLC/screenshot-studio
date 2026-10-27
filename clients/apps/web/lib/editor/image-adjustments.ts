import { z } from 'zod'
import type { ImageFilters } from '@/lib/store'

/**
 * The one definition of the screenshot's image adjustments: which exist,
 * their ranges and neutral values, how they draw, and how automatic
 * enhancement picks values. The Adjust panel, the canvas, and device screens
 * all read from here.
 */

/** A manual adjustment; one per `ImageFilters` field. */
export const imageAdjustmentSchema = z.enum([
  'brightness',
  'contrast',
  'saturate',
  'hueRotate',
  'grayscale',
  'sepia',
  'invert',
  'blur',
])
/** A manual adjustment key. */
export type ImageAdjustment = z.infer<typeof imageAdjustmentSchema>

/** How the Adjust panel groups its sliders. */
export const imageAdjustmentGroupSchema = z.enum(['light', 'color', 'effects'])

/** Every adjustment at its neutral value: the image as it was captured. */
export const NEUTRAL_IMAGE_FILTERS: ImageFilters = {
  blur: 0,
  brightness: 100,
  contrast: 100,
  grayscale: 0,
  hueRotate: 0,
  invert: 0,
  saturate: 100,
  sepia: 0,
}

/** Range, neutral value, and label for every adjustment, in panel order. */
export const IMAGE_ADJUSTMENTS: readonly {
  group: z.infer<typeof imageAdjustmentGroupSchema>
  key: ImageAdjustment
  label: string
  max: number
  min: number
  neutral: number
  step: number
  unit: string
}[] = [
  { group: 'light', key: 'brightness', label: 'Brightness', max: 200, min: 0, neutral: NEUTRAL_IMAGE_FILTERS.brightness, step: 1, unit: '%' },
  { group: 'light', key: 'contrast', label: 'Contrast', max: 200, min: 0, neutral: NEUTRAL_IMAGE_FILTERS.contrast, step: 1, unit: '%' },
  { group: 'color', key: 'saturate', label: 'Saturation', max: 200, min: 0, neutral: NEUTRAL_IMAGE_FILTERS.saturate, step: 1, unit: '%' },
  { group: 'color', key: 'hueRotate', label: 'Hue', max: 360, min: 0, neutral: NEUTRAL_IMAGE_FILTERS.hueRotate, step: 1, unit: '°' },
  { group: 'color', key: 'grayscale', label: 'Grayscale', max: 100, min: 0, neutral: NEUTRAL_IMAGE_FILTERS.grayscale, step: 1, unit: '%' },
  { group: 'color', key: 'sepia', label: 'Sepia', max: 100, min: 0, neutral: NEUTRAL_IMAGE_FILTERS.sepia, step: 1, unit: '%' },
  { group: 'effects', key: 'invert', label: 'Invert', max: 100, min: 0, neutral: NEUTRAL_IMAGE_FILTERS.invert, step: 1, unit: '%' },
  { group: 'effects', key: 'blur', label: 'Blur', max: 20, min: 0, neutral: NEUTRAL_IMAGE_FILTERS.blur, step: 0.5, unit: 'px' },
]

/** True when any adjustment differs from neutral. */
export function hasImageAdjustments(filters: ImageFilters): boolean {
  return IMAGE_ADJUSTMENTS.some(({ key, neutral }) => filters[key] !== neutral)
}

/** The CSS `filter` that draws these adjustments, or undefined when all are neutral. */
export function imageFilterCss(filters: ImageFilters | undefined): string | undefined {
  if (!filters) return undefined
  const parts: string[] = []
  if (filters.brightness !== 100) parts.push(`brightness(${filters.brightness / 100})`)
  if (filters.contrast !== 100) parts.push(`contrast(${filters.contrast / 100})`)
  if (filters.saturate !== 100) parts.push(`saturate(${filters.saturate / 100})`)
  if (filters.grayscale > 0) parts.push(`grayscale(${filters.grayscale / 100})`)
  if (filters.sepia > 0) parts.push(`sepia(${filters.sepia / 100})`)
  if (filters.hueRotate !== 0) parts.push(`hue-rotate(${filters.hueRotate}deg)`)
  if (filters.blur > 0) parts.push(`blur(${filters.blur}px)`)
  if (filters.invert > 0) parts.push(`invert(${filters.invert / 100})`)
  return parts.length > 0 ? parts.join(' ') : undefined
}

/** Tonal statistics of an image, each 0-1. */
export type ImageTonalStats = {
  /** 2nd and 98th percentile luminance. */
  low: number
  high: number
  meanLuminance: number
  meanSaturation: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Adjustments that correct a dull or dark screenshot. Screenshots are mostly
 * flat UI, so this only stretches a compressed tonal range, lifts a dark
 * image, and adds a little saturation to a washed-out one; it never darkens a
 * bright UI. Everything else returns to neutral.
 */
export function autoEnhanceFilters(stats: ImageTonalStats): ImageFilters {
  const range = Math.max(0.05, stats.high - stats.low)
  const contrast = clamp(0.9 / range, 1, 1.4)
  const brightness = stats.meanLuminance < 0.35 ? clamp(0.45 / Math.max(0.05, stats.meanLuminance), 1, 1.3) : 1
  const saturate = stats.meanSaturation < 0.2 ? 1.1 : 1
  return {
    ...NEUTRAL_IMAGE_FILTERS,
    brightness: Math.round(brightness * 100),
    contrast: Math.round(contrast * 100),
    saturate: Math.round(saturate * 100),
  }
}

/** Tonal statistics from RGBA pixels (as from `getImageData`). */
export function tonalStats(pixels: ArrayLike<number>): ImageTonalStats {
  const histogram = new Array<number>(256).fill(0)
  let count = 0
  let luminanceSum = 0
  let saturationSum = 0
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 16) continue
    const r = pixels[index] / 255
    const g = pixels[index + 1] / 255
    const b = pixels[index + 2] / 255
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    histogram[Math.round(luminance * 255)]++
    luminanceSum += luminance
    saturationSum += max === 0 ? 0 : (max - min) / max
    count++
  }
  if (count === 0) return { high: 1, low: 0, meanLuminance: 0.5, meanSaturation: 0.5 }
  const percentile = (fraction: number) => {
    let seen = 0
    for (let level = 0; level < 256; level++) {
      seen += histogram[level]
      if (seen >= count * fraction) return level / 255
    }
    return 1
  }
  return {
    high: percentile(0.98),
    low: percentile(0.02),
    meanLuminance: luminanceSum / count,
    meanSaturation: saturationSum / count,
  }
}

/** Measure an image (any loadable URL) in the browser, at low resolution. */
export async function measureImage(src: string): Promise<ImageTonalStats> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = src
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = Math.max(1, Math.round((96 * image.naturalHeight) / Math.max(1, image.naturalWidth)))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas is unavailable.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return tonalStats(context.getImageData(0, 0, canvas.width, canvas.height).data)
}

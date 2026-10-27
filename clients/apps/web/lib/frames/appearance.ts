import type { Appearance, Tone } from './schema'

/**
 * Automatic chrome appearance: a browser or window frame in `auto` follows
 * the screenshot under it, light chrome over a light page and dark over a
 * dark one. The tone comes from the content's top rows, where the chrome
 * meets it.
 */

/** Below this relative luminance, black and white text contrast equally: dark content. */
export const TONE_THRESHOLD = 0.179

/** Share of the image height sampled from its top edge. */
const SAMPLE_ROWS = 0.06

const linear = (channel: number) => {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of an sRGB color, 0 (black) to 1 (white). */
export function relativeLuminance(red: number, green: number, blue: number): number {
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

/** Mean luminance of RGBA pixels, weighted by alpha; fully transparent pixels count as white. */
export function averageLuminance(pixels: ArrayLike<number>): number {
  let total = 0
  let count = 0
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3]! / 255
    const luminance = relativeLuminance(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!)
    total += luminance * alpha + (1 - alpha)
    count++
  }
  return count === 0 ? 1 : total / count
}

/** Light or dark, for a luminance. */
export function toneForLuminance(luminance: number): Tone {
  return luminance > TONE_THRESHOLD ? 'light' : 'dark'
}

/** The tone chrome is drawn in: the setting, or for `auto` the content's tone (light when unknown). */
export function resolveAppearance(appearance: Appearance, contentTone: Tone | undefined): Tone {
  return appearance === 'auto' ? (contentTone ?? 'light') : appearance
}

const tones = new Map<string, Promise<Tone>>()

/**
 * The tone of an image's top rows. Browser only; cached per source. Images
 * that cannot be read (tainted or broken) resolve to light.
 */
export function sampleImageTone(src: string): Promise<Tone> {
  const cached = tones.get(src)
  if (cached) return cached
  const sample = new Promise<Tone>((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      try {
        const width = 64
        const sourceRows = Math.max(1, Math.round(image.naturalHeight * SAMPLE_ROWS))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = 8
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return resolve('light')
        context.drawImage(image, 0, 0, image.naturalWidth, sourceRows, 0, 0, width, canvas.height)
        resolve(
          toneForLuminance(averageLuminance(context.getImageData(0, 0, width, canvas.height).data))
        )
      } catch {
        resolve('light')
      }
    }
    image.onerror = () => resolve('light')
    image.src = src
  })
  tones.set(src, sample)
  // Sources can be large data URLs; keep only the recent ones alive.
  if (tones.size > 40) tones.delete(tones.keys().next().value!)
  return sample
}

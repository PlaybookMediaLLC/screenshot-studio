import { z } from 'zod'

/**
 * Google Fonts, loaded on demand from the Google Fonts CSS API. A text layer
 * names one as `google:<Family Name>`; the editor's own fonts keep their ids.
 * The same stylesheet loads in the editor, the render frame, and the headless
 * renderer (which allows the two Google Fonts origins), so every export uses
 * the font the user picked. A family that fails to load falls back to its
 * category's system fonts and the editor says so.
 */

/** The prefix of a Google Fonts family id. */
export const GOOGLE_FONT_PREFIX = 'google:'
/** Origins the Google Fonts API serves stylesheets and font files from. */
export const GOOGLE_FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'] as const

const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 ]{0,58}[A-Za-z0-9]$/

/** A font category, for fallbacks and grouping. */
export const fontCategorySchema = z.enum(['sans-serif', 'serif', 'display', 'handwriting', 'monospace'])
/** A font category. */
export type FontCategory = z.infer<typeof fontCategorySchema>

/** A Google Fonts family the editor offers. */
export type GoogleFont = { category: FontCategory; family: string; weights: readonly string[] }

const W = ['normal', '500', '600', 'bold'] as const
const WIDE = ['300', 'normal', '500', '600', 'bold', '800', '900'] as const

/** Popular families, grouped by category. Any other family can be typed in by name. */
export const GOOGLE_FONTS: readonly GoogleFont[] = [
  ...['Roboto', 'Open Sans', 'Montserrat', 'Lato', 'Raleway', 'Nunito', 'Rubik', 'Work Sans', 'Manrope',
    'Plus Jakarta Sans', 'Sora', 'Outfit', 'Lexend', 'Urbanist', 'Barlow', 'Archivo', 'Figtree', 'Onest',
    'Bricolage Grotesque', 'Schibsted Grotesk', 'Instrument Sans', 'Albert Sans', 'Red Hat Display', 'Mulish']
    .map((family) => ({ category: 'sans-serif' as const, family, weights: WIDE })),
  ...['Playfair Display', 'Merriweather', 'Lora', 'EB Garamond', 'Cormorant Garamond', 'Libre Baskerville',
    'Fraunces', 'DM Serif Display', 'Instrument Serif', 'Source Serif 4', 'Newsreader', 'Young Serif']
    .map((family) => ({ category: 'serif' as const, family, weights: W })),
  ...['Bebas Neue', 'Anton', 'Archivo Black', 'Oswald', 'Syne', 'Unbounded', 'Righteous', 'Bungee',
    'Chakra Petch', 'Orbitron', 'Big Shoulders Display', 'Rubik Mono One']
    .map((family) => ({ category: 'display' as const, family, weights: W })),
  ...['Caveat', 'Dancing Script', 'Pacifico', 'Permanent Marker', 'Kalam', 'Shadows Into Light', 'Satisfy']
    .map((family) => ({ category: 'handwriting' as const, family, weights: ['normal', 'bold'] as const })),
  ...['JetBrains Mono', 'Fira Code', 'IBM Plex Mono', 'Source Code Pro', 'Space Mono', 'DM Mono', 'Geist Mono']
    .map((family) => ({ category: 'monospace' as const, family, weights: W })),
]

const FALLBACKS: Record<FontCategory, string> = {
  display: 'Impact, "Arial Black", sans-serif',
  handwriting: '"Comic Sans MS", cursive',
  monospace: 'ui-monospace, "SF Mono", Menlo, monospace',
  'sans-serif': 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
}

/** True for a well-formed Google Fonts family id. */
export function isGoogleFontId(id: string): boolean {
  return id.startsWith(GOOGLE_FONT_PREFIX) && FAMILY.test(id.slice(GOOGLE_FONT_PREFIX.length))
}

/** The id for a family name, or null when the name is not a plausible family. */
export function googleFontId(family: string): string | null {
  const name = family.trim().replace(/\s+/g, ' ')
  return FAMILY.test(name) ? `${GOOGLE_FONT_PREFIX}${name}` : null
}

/** The family name of a Google Fonts id. */
export function googleFontFamily(id: string): string {
  return id.slice(GOOGLE_FONT_PREFIX.length)
}

/** The catalog entry for a family, if the editor lists it. */
export function findGoogleFont(id: string): GoogleFont | undefined {
  const family = googleFontFamily(id)
  return GOOGLE_FONTS.find((font) => font.family === family)
}

/** The CSS font-family value for a Google Fonts id, with a category fallback. */
export function googleFontCss(id: string): string {
  const category = findGoogleFont(id)?.category ?? 'sans-serif'
  return `"${googleFontFamily(id)}", ${FALLBACKS[category]}`
}

/** Weights to offer for a Google Fonts id. */
export function googleFontWeights(id: string): string[] {
  return [...(findGoogleFont(id)?.weights ?? W)]
}

const NUMERIC_WEIGHT: Record<string, string> = { bold: '700', normal: '400' }

/** The Google Fonts CSS2 stylesheet URL for a family and the weights in use. */
export function googleFontsStylesheet(id: string, weights: readonly string[]): string {
  const numeric = [...new Set(weights.map((weight) => NUMERIC_WEIGHT[weight] ?? weight))]
    .filter((weight) => /^[1-9]00$/.test(weight))
    .sort()
  const family = encodeURIComponent(googleFontFamily(id)).replace(/%20/g, '+')
  const axis = numeric.length ? `:wght@${numeric.join(';')}` : ''
  return `${GOOGLE_FONT_ORIGINS[0]}/css2?family=${family}${axis}&display=block`
}

/** A family Google Fonts definitively rejects, distinct from an offline load. */
export class InvalidGoogleFontFamily extends Error {}

const loads = new Map<string, Promise<void>>()

/**
 * Load a Google Fonts family in this document, once per family and weight
 * set. Resolves when the browser can draw it; rejects when the family does
 * not exist or cannot be fetched, so the caller can warn the user.
 */
export function loadGoogleFont(id: string, weights: readonly string[], timeoutMs = 12_000): Promise<void> {
  if (!isGoogleFontId(id)) return Promise.reject(new Error(`Not a Google Fonts family: ${id}`))
  const href = googleFontsStylesheet(id, weights)
  const existing = loads.get(href)
  if (existing) return existing
  const load = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.crossOrigin = 'anonymous'
    link.dataset.googleFont = googleFontFamily(id)
    const timer = setTimeout(() => reject(new Error(`${googleFontFamily(id)} took too long to load.`)), timeoutMs)
    link.onerror = async () => {
      clearTimeout(timer)
      link.remove()
      // Some display families only provide one weight. Ask for their default
      // face before deciding the family is invalid; browsers synthesize bold.
      if (weights.length) {
        try { await loadGoogleFont(id, [], timeoutMs); resolve() }
        catch (error) { reject(error) }
        return
      }
      try {
        const response = await fetch(href, { signal: AbortSignal.timeout(timeoutMs) })
        if (response.status === 400 || response.status === 404) {
          reject(new InvalidGoogleFontFamily(`${googleFontFamily(id)} is not a Google Fonts family.`))
          return
        }
      } catch { /* An offline request must not rewrite a saved font. */ }
      reject(new Error(`${googleFontFamily(id)} is not available from Google Fonts.`))
    }
    link.onload = () => {
      const family = `"${googleFontFamily(id)}"`
      Promise.all(
        (weights.length ? weights : ['normal']).map((weight) =>
          document.fonts.load(`${NUMERIC_WEIGHT[weight] ?? weight} 1em ${family}`)
        )
      ).then(
        () => {
          clearTimeout(timer)
          resolve()
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error('The font could not be loaded.'))
        }
      )
    }
    document.head.appendChild(link)
  })
  load.catch(() => loads.delete(href))
  loads.set(href, load)
  return load
}

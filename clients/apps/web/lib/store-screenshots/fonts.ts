import { z } from 'zod'
import type { FontSource } from './document/schema'

/**
 * Font catalog for store screenshots.
 *
 * Bundled fonts are self-hosted by `next/font` in `app/layout.tsx` and
 * referenced through their CSS variables, so the editor and the exporter see
 * identical glyphs. Google fonts and uploaded fonts are registered per
 * project (`StoreDocument.fonts`) and loaded with `ensureProjectFonts`.
 */

/** Font picker groups. */
export const fontCategorySchema = z.enum(['sans', 'serif', 'display'])

/** A selectable font. `value` is the CSS font-family stack stored in documents. */
export type FontOption = { name: string; value: string; category: z.infer<typeof fontCategorySchema> }

/** Fonts that ship with the app. */
export const BUNDLED_FONTS: FontOption[] = [
  { name: 'Inter', value: 'var(--font-inter), system-ui, sans-serif', category: 'sans' },
  { name: 'Geist', value: 'var(--font-geist-sans), system-ui, sans-serif', category: 'sans' },
  { name: 'DM Sans', value: 'var(--font-dm-sans), system-ui, sans-serif', category: 'sans' },
  { name: 'Poppins', value: 'var(--font-poppins), system-ui, sans-serif', category: 'sans' },
  { name: 'Manrope', value: 'var(--font-manrope), system-ui, sans-serif', category: 'sans' },
  { name: 'Montserrat', value: 'var(--font-montserrat), system-ui, sans-serif', category: 'sans' },
  {
    name: 'Plus Jakarta Sans',
    value: 'var(--font-plus-jakarta-sans), system-ui, sans-serif',
    category: 'sans',
  },
  { name: 'Sora', value: 'var(--font-sora), system-ui, sans-serif', category: 'sans' },
  { name: 'Outfit', value: 'var(--font-outfit), system-ui, sans-serif', category: 'sans' },
  {
    name: 'Space Grotesk',
    value: 'var(--font-space-grotesk), system-ui, sans-serif',
    category: 'sans',
  },
  { name: 'Work Sans', value: 'var(--font-work-sans), system-ui, sans-serif', category: 'sans' },
  { name: 'Raleway', value: 'var(--font-raleway), system-ui, sans-serif', category: 'sans' },
  { name: 'Lexend', value: 'var(--font-lexend), system-ui, sans-serif', category: 'sans' },
  { name: 'Urbanist', value: 'var(--font-urbanist), system-ui, sans-serif', category: 'sans' },
  {
    name: 'Albert Sans',
    value: 'var(--font-albert-sans), system-ui, sans-serif',
    category: 'sans',
  },
  {
    name: 'Playfair Display',
    value: 'var(--font-playfair-display), Georgia, serif',
    category: 'serif',
  },
  { name: 'Lora', value: 'var(--font-lora), Georgia, serif', category: 'serif' },
  {
    name: 'Libre Baskerville',
    value: 'var(--font-libre-baskerville), Georgia, serif',
    category: 'serif',
  },
  { name: 'Oswald', value: 'var(--font-oswald), Arial Narrow, sans-serif', category: 'display' },
  {
    name: 'Bebas Neue',
    value: 'var(--font-bebas-neue), Arial Narrow, sans-serif',
    category: 'display',
  },
  { name: 'Righteous', value: 'var(--font-righteous), system-ui, sans-serif', category: 'display' },
  { name: 'Caveat', value: 'var(--font-caveat), cursive', category: 'display' },
]

/** The default font stack. */
export const DEFAULT_FONT_FAMILY = BUNDLED_FONTS[0].value

/**
 * Google fonts suggested in the picker. The first five cover scripts the
 * bundled Latin fonts cannot render, so localized sets stay legible.
 */
export const SUGGESTED_GOOGLE_FONTS = [
  'Noto Sans JP',
  'Noto Sans KR',
  'Noto Sans SC',
  'Noto Sans Arabic',
  'Noto Sans Hebrew',
  'Noto Sans Devanagari',
  'Noto Sans Thai',
  'Roboto',
  'Open Sans',
  'Nunito',
  'Rubik',
  'Archivo',
  'Fraunces',
  'Bricolage Grotesque',
  'Instrument Serif',
  'Unbounded',
] as const

/** CSS stack for a project font family. */
export function fontStackFor(source: FontSource): string {
  return `"${source.family}", system-ui, sans-serif`
}

/** Display name of a stored font stack, for pickers and labels. */
export function fontNameFor(stack: string): string {
  const bundled = BUNDLED_FONTS.find((font) => font.value === stack)
  if (bundled) return bundled.name
  const quoted = /^"([^"]+)"/.exec(stack)
  return quoted?.[1] ?? stack.split(',')[0].trim()
}

/** Google Fonts stylesheet URL for a family, with the weights the editor offers. */
export function googleFontStylesheetUrl(family: string): string {
  const name = encodeURIComponent(family).replace(/%20/g, '+')
  return `https://fonts.googleapis.com/css2?family=${name}:ital,wght@0,100..900;1,100..900&display=swap`
}

/** Upload limit for custom font files. */
export const MAX_FONT_BYTES = 5 * 1024 * 1024

/** Font container formats accepted for upload, by file signature. */
export const fontFormatSchema = z.enum(['woff2', 'woff', 'truetype', 'opentype'])

/** Font container format. */
export type FontFormat = z.infer<typeof fontFormatSchema>

/**
 * Identify a font file by its signature rather than its extension or MIME
 * type, which browsers report inconsistently. Returns null for anything that
 * is not a font container.
 */
export function detectFontFormat(bytes: Uint8Array): FontFormat | null {
  if (bytes.length < 4) return null
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (tag === 'wOF2') return 'woff2'
  if (tag === 'wOFF') return 'woff'
  if (tag === 'OTTO') return 'opentype'
  if (tag === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) {
    return 'truetype'
  }
  return null
}

/** MIME type to store for a font format. */
export function fontMime(format: FontFormat): string {
  return format === 'woff2'
    ? 'font/woff2'
    : format === 'woff'
      ? 'font/woff'
      : format === 'opentype'
        ? 'font/otf'
        : 'font/ttf'
}

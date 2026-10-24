import { fontFamilies } from '@/lib/constants/fonts'
import { type ProhibitedTermMatchMode, prohibitedTermMatchModeSchema } from '@/lib/tenant/schemas'

/**
 * Apply a workspace brand kit to editor designs.
 *
 * A brand kit stores colors (background, text, accent), a heading font, and
 * optionally a logo asset. Designs get a gradient from the brand background to
 * the accent, brand text color, and the brand catalog font. The critique and
 * the agent may still vary designs, but always within these values.
 *
 * Kits saved before RFC 019 use `colors.foreground` and a free-text
 * `typography.fontFamily`; both still read.
 */

export type BrandKitValues = {
  accent: string
  background: string
  /** Heading font: a catalog id, or a typeface name on legacy kits. */
  fontFamily: string | null
  /** Text color (`colors.text`, or legacy `colors.foreground`). */
  foreground: string
  /** Uploaded primary logo asset id, if the kit has one. */
  logoAssetId: string | null
  name: string
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function color(value: unknown): string | null {
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : null
}

/** Read a stored brand kit definition; null when it lacks usable colors. */
export function parseBrandKit(name: string, definition: unknown): BrandKitValues | null {
  const root =
    definition && typeof definition === 'object' ? (definition as Record<string, unknown>) : {}
  const colors =
    root.colors && typeof root.colors === 'object' ? (root.colors as Record<string, unknown>) : {}
  const typography =
    root.typography && typeof root.typography === 'object'
      ? (root.typography as Record<string, unknown>)
      : {}
  const background = color(colors.background)
  const foreground = color(colors.text) ?? color(colors.foreground)
  const accent = color(colors.accent) ?? background
  if (!background || !foreground || !accent) return null
  const font = typography.headingFamily ?? typography.fontFamily
  const fontFamily = typeof font === 'string' && font.trim() ? font.trim() : null
  const logo =
    root.logo && typeof root.logo === 'object' ? (root.logo as Record<string, unknown>) : {}
  const logoAssetId = typeof logo.primaryAssetId === 'string' ? logo.primaryAssetId : null
  return { accent, background, fontFamily, foreground, logoAssetId, name }
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

/** The editor font id that matches a brand typeface name, if the catalog has it. */
export function brandFontId(fontFamily: string | null): string | null {
  if (!fontFamily) return null
  const wanted = slug(fontFamily.split(',')[0] ?? '')
  const match =
    fontFamilies.find((font) => font.id === wanted) ??
    fontFamilies.find((font) => slug(font.name) === wanted)
  return match?.id ?? null
}

export function brandGradient(kit: BrandKitValues): string {
  return `linear-gradient(135deg, ${kit.background} 0%, ${kit.accent} 100%)`
}

type TextLike = { color?: string; fontFamily?: string } & Record<string, unknown>

/**
 * Design changes that put a design on brand: background and every text layer.
 * Returns plain objects shaped like DesignChanges so callers can merge them.
 */
export function brandDesignChanges(
  kit: BrandKitValues,
  texts: readonly TextLike[]
): { background: { type: 'gradient'; value: string }; texts?: TextLike[] } {
  const fontId = brandFontId(kit.fontFamily)
  return {
    background: { type: 'gradient', value: brandGradient(kit) },
    ...(texts.length > 0
      ? {
          texts: texts.map((text) => ({
            ...text,
            color: kit.foreground,
            ...(fontId ? { fontFamily: fontId } : {}),
          })),
        }
      : {}),
  }
}

/** Relative luminance contrast ratio between two hex colors (WCAG). */
export function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) => {
    const value = hex.replace('#', '')
    const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value
    const [r, g, b] = [0, 2, 4].map((index) => {
      const channel = parseInt(full.slice(index, index + 2), 16) / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

/** A prohibited term as the brand settings edit it: an empty reason means none. */
export type ProhibitedTermEntry = {
  matchMode: ProhibitedTermMatchMode
  reason: string
  term: string
}

/**
 * The prohibited terms as entries. The backend returns objects
 * (`{ term, reason, matchMode }`); older workspaces stored strings, which
 * read as word-mode terms with no reason.
 */
export function prohibitedTermEntries(terms: unknown): ProhibitedTermEntry[] {
  if (!Array.isArray(terms)) return []
  return terms.flatMap((entry): ProhibitedTermEntry[] => {
    if (typeof entry === 'string') {
      return entry.trim() ? [{ matchMode: 'word', reason: '', term: entry }] : []
    }
    if (entry && typeof entry === 'object' && 'term' in entry && typeof entry.term === 'string') {
      if (!entry.term.trim()) return []
      const mode = prohibitedTermMatchModeSchema.safeParse(
        'matchMode' in entry ? entry.matchMode : undefined
      )
      const reason = 'reason' in entry && typeof entry.reason === 'string' ? entry.reason : ''
      return [{ matchMode: mode.success ? mode.data : 'word', reason, term: entry.term }]
    }
    return []
  })
}

/** The prohibited terms as plain strings, from either stored shape. */
export function prohibitedTermList(terms: unknown): string[] {
  return prohibitedTermEntries(terms).map((entry) => entry.term)
}

/**
 * Edited entries as the backend takes them: trimmed, blank rows dropped, an
 * empty reason omitted, and a repeated term in the same mode kept once.
 */
export function prohibitedTermsForSave(entries: readonly ProhibitedTermEntry[]) {
  const seen = new Set<string>()
  return entries.flatMap((entry) => {
    const term = entry.term.trim()
    const reason = entry.reason.trim()
    const key = `${entry.matchMode}:${term.toLowerCase()}`
    if (!term || seen.has(key)) return []
    seen.add(key)
    return [{ matchMode: entry.matchMode, ...(reason ? { reason } : {}), term }]
  })
}

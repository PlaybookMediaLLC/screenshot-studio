import { fontFamilies } from '@/lib/constants/fonts'

/**
 * Apply a workspace brand kit to editor designs.
 *
 * A brand kit stores colors (background, foreground, accent) and a typeface.
 * Designs get a gradient from the brand background to the accent, brand text
 * color, and the catalog font closest to the brand typeface. The critique and
 * the agent may still vary designs, but always within these values.
 */

export type BrandKitValues = {
  accent: string
  background: string
  fontFamily: string | null
  foreground: string
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
  const foreground = color(colors.foreground)
  const accent = color(colors.accent) ?? background
  if (!background || !foreground || !accent) return null
  const fontFamily =
    typeof typography.fontFamily === 'string' && typography.fontFamily.trim()
      ? typography.fontFamily.trim()
      : null
  return { accent, background, fontFamily, foreground, name }
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

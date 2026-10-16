import { z } from 'zod'

/**
 * Text styling beyond colour and font: gradient fills, alignment, a text
 * box with shrink-to-fit or wrapping, spacing, and the headline/subheadline
 * roles typography templates use. Shared by the store, the document, the
 * canvas, and the inspector.
 */

const color = z.string().regex(/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i)

/** How a text layer is filled. */
export const textFillSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid') }),
  z.object({ angle: z.number().min(0).max(360), from: color, kind: z.literal('gradient'), to: color }),
])
/** A text fill: the layer's colour, or a linear gradient. */
export type TextFill = z.infer<typeof textFillSchema>

/** Horizontal alignment of a text layer's lines. */
export const textAlignSchema = z.enum(['left', 'center', 'right'])
/** A text alignment. */
export type TextAlign = z.infer<typeof textAlignSchema>

/** What a text box does with text wider than it: nothing, shrink the text, or wrap lines. */
export const textFitSchema = z.enum(['none', 'shrink', 'wrap'])
/** A text fit mode. */
export type TextFit = z.infer<typeof textFitSchema>

/** The part a text layer plays in a typography template. */
export const textRoleSchema = z.enum(['headline', 'subheadline', 'label', 'body'])
/** A text role. */
export type TextRole = z.infer<typeof textRoleSchema>

/** CSS for a fill. A gradient clips a background to the glyphs. */
export function textFillCss(fill: TextFill | undefined, color: string): Record<string, string> {
  if (!fill || fill.kind === 'solid') return { color }
  return {
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    backgroundImage: `linear-gradient(${fill.angle}deg, ${fill.from}, ${fill.to})`,
    color: fill.from,
  }
}

/**
 * The font size that fits the widest line inside `maxWidth`, never larger
 * than the chosen size and never below `minSize`. `measure` returns a line's
 * width at `fontSize`.
 */
export function fitFontSize(
  lines: readonly string[],
  fontSize: number,
  maxWidth: number,
  measure: (line: string) => number,
  minSize = 6
): number {
  const widest = Math.max(0, ...lines.map(measure))
  if (widest <= maxWidth || widest === 0) return fontSize
  return Math.max(minSize, Math.floor(fontSize * (maxWidth / widest) * 100) / 100)
}

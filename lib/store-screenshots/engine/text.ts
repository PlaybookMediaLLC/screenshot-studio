import { z } from 'zod'
import { hashRichText } from '../document/factory'
import type { RichText, TextLayer, TextStyle, Theme, Translation } from '../document/schema'

/**
 * Text resolution and measurement.
 *
 * Measurement is injected: the browser measures with the same DOM and CSS
 * the renderer paints (`dom-measurer.ts`), so reserved space matches the
 * painted text exactly; tests and server code use the deterministic
 * approximation below.
 */

/** Writing direction. */
export const textDirectionSchema = z.enum(['ltr', 'rtl'])

/** How the text shown for a locale relates to the source copy. */
export const translationStateSchema = z.enum(['source', 'translated', 'outdated', 'missing'])

/** Writing direction. */
export type TextDirection = z.infer<typeof textDirectionSchema>
/** Translation state. */
export type TranslationState = z.infer<typeof translationStateSchema>

/** Languages written right to left. */
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ug'])

/** Direction for a BCP 47 locale. */
export function directionForLocale(locale: string): TextDirection {
  return RTL_LANGUAGES.has(locale.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr'
}

/** The text a layer shows in a locale, and whether it is translated. */
export function localizedContent(
  layer: TextLayer,
  locale: string,
  sourceLocale: string
): { content: RichText; state: TranslationState; translation: Translation | null } {
  if (locale === sourceLocale) return { content: layer.content, state: 'source', translation: null }
  const translation = layer.translations[locale]
  if (!translation) return { content: layer.content, state: 'missing', translation: null }
  const outdated = translation.sourceHash !== hashRichText(layer.content)
  return { content: translation.content, state: outdated ? 'outdated' : 'translated', translation }
}

/** Theme role style, then layer overrides, then locale overrides. */
export function resolveTextStyle(layer: TextLayer, theme: Theme, locale: string): TextStyle {
  return {
    ...theme.textStyles[layer.role],
    ...layer.style,
    ...(layer.localeOverrides[locale]?.style ?? {}),
  }
}

/** A measurement request, in output pixels. */
export type MeasureRequest = {
  content: RichText
  style: TextStyle
  fontSizePx: number
  widthPx: number
  direction: TextDirection
}

/** Measured text block. */
export type MeasureResult = { width: number; height: number; lines: number }

/** Measures a text block. */
export type TextMeasurer = (request: MeasureRequest) => MeasureResult

const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/

/**
 * A font-independent estimate: average advance of 0.52em adjusted for
 * weight, case, and tracking; greedy word wrap; CJK breaks per character.
 * Deterministic, for tests and environments without a DOM.
 */
export const approximateMeasurer: TextMeasurer = ({ content, style, fontSizePx, widthPx }) => {
  const weightFactor = 1 + (style.fontWeight - 400) / 2000
  const caseFactor = style.uppercase ? 1.12 : 1
  const advance = fontSizePx * (0.52 * weightFactor * caseFactor + style.letterSpacing)
  const text = content.map((span) => span.text).join('')
  const paragraphs = text.split('\n')
  let lines = 0
  let widest = 0
  for (const paragraph of paragraphs) {
    const tokens = paragraph.split(/(\s+)/).flatMap((token) =>
      CJK.test(token) ? Array.from(token) : [token]
    )
    let lineWidth = 0
    let paragraphLines = 1
    for (const token of tokens) {
      const tokenWidth = Array.from(token).length * advance
      if (style.wrap && lineWidth > 0 && lineWidth + tokenWidth > widthPx && token.trim()) {
        widest = Math.max(widest, lineWidth)
        paragraphLines += 1
        lineWidth = token.trim() ? tokenWidth : 0
      } else {
        lineWidth += tokenWidth
      }
    }
    widest = Math.max(widest, lineWidth)
    lines += paragraphLines
  }
  return {
    width: Math.min(style.wrap ? widthPx : Number.POSITIVE_INFINITY, widest),
    height: lines * style.lineHeight * fontSizePx,
    lines,
  }
}

/** Whether rich text has any visible characters. */
export function hasVisibleText(content: RichText): boolean {
  return content.some((span) => span.text.trim().length > 0)
}

import type { CSSProperties } from 'react'
import type { TextSpan, TextStyle } from '@/lib/store-screenshots/document/schema'
import type { TextDirection } from '@/lib/store-screenshots/engine/text'

/**
 * CSS for rich text. The renderer, the DOM text measurer, and the inline
 * editor all use these two functions, so measured, painted, and edited text
 * wrap identically.
 */

/** Block-level CSS for a text layer. */
export function textBlockStyle(style: TextStyle, fontSizePx: number, color: string, direction: TextDirection): CSSProperties {
  return {
    fontFamily: style.fontFamily,
    fontSize: `${fontSizePx}px`,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: `${style.letterSpacing}em`,
    textAlign: style.align,
    fontStyle: style.italic ? 'italic' : 'normal',
    textTransform: style.uppercase ? 'uppercase' : 'none',
    whiteSpace: style.wrap ? 'pre-wrap' : 'pre',
    overflowWrap: 'break-word',
    direction,
    color,
    margin: 0,
    padding: 0,
    fontKerning: 'normal',
    fontVariantLigatures: 'common-ligatures',
    textRendering: 'geometricPrecision',
  }
}

/** Inline CSS for one span. */
export function spanStyle(span: TextSpan, style: TextStyle): CSSProperties {
  const css: CSSProperties = {}
  if (span.bold) css.fontWeight = Math.min(900, Math.max(700, style.fontWeight + 200))
  if (span.italic) css.fontStyle = 'italic'
  if (span.color) css.color = span.color
  if (span.decoration === 'underline') css.textDecoration = 'underline'
  if (span.decoration === 'strike') css.textDecoration = 'line-through'
  if (span.highlight) {
    css.backgroundColor = span.highlight
    css.borderRadius = '0.32em'
    css.padding = '0 0.22em'
    css.boxDecorationBreak = 'clone'
    css.WebkitBoxDecorationBreak = 'clone'
  }
  if (span.gradient) {
    css.backgroundImage = `linear-gradient(90deg, ${span.gradient.from}, ${span.gradient.to})`
    css.WebkitBackgroundClip = 'text'
    css.backgroundClip = 'text'
    css.color = 'transparent'
    css.WebkitTextFillColor = 'transparent'
  }
  return css
}

import type { RichText, TextSpan } from '../document/schema'

/**
 * Pure rich-text editing on the span model. Offsets count UTF-16 code units
 * of the concatenated plain text, which is what DOM selections report.
 */

/** Formatting carried by a span (everything except its text). */
export type SpanMarks = Omit<TextSpan, 'text'>

/** A formatting change: values to set, and mark names to clear. */
export type MarkChange = { set?: SpanMarks; clear?: Array<keyof SpanMarks> }

function marksOf(span: TextSpan): SpanMarks {
  const { text: _text, ...marks } = span
  return marks
}

function sameMarks(a: TextSpan, b: TextSpan): boolean {
  return JSON.stringify(marksOf(a), Object.keys(marksOf(a)).sort()) === JSON.stringify(marksOf(b), Object.keys(marksOf(b)).sort())
}

/** Merge neighbouring spans with identical formatting and drop empty ones. */
export function normalizeSpans(spans: RichText): RichText {
  const result: TextSpan[] = []
  for (const span of spans) {
    if (!span.text) continue
    const last = result.at(-1)
    if (last && sameMarks(last, span)) result[result.length - 1] = { ...last, text: last.text + span.text }
    else result.push({ ...span })
  }
  return result.length ? result : [{ text: '' }]
}

/** Total plain-text length. */
export function richTextLength(spans: RichText): number {
  return spans.reduce((total, span) => total + span.text.length, 0)
}

function splitAt(spans: RichText, offset: number): TextSpan[] {
  const result: TextSpan[] = []
  let position = 0
  for (const span of spans) {
    const end = position + span.text.length
    if (offset > position && offset < end) {
      result.push({ ...span, text: span.text.slice(0, offset - position) }, { ...span, text: span.text.slice(offset - position) })
    } else {
      result.push(span)
    }
    position = end
  }
  return result
}

function applyChange(span: TextSpan, change: MarkChange): TextSpan {
  const next: TextSpan = { ...span, ...change.set }
  for (const key of change.clear ?? []) delete next[key]
  return next
}

/** Apply a formatting change to the characters in [start, end). */
export function applyMarks(spans: RichText, start: number, end: number, change: MarkChange): RichText {
  if (end <= start) return spans
  const pieces = splitAt(splitAt(spans, start), end)
  let position = 0
  const changed = pieces.map((span) => {
    const from = position
    position += span.text.length
    return from >= start && position <= end ? applyChange(span, change) : span
  })
  return normalizeSpans(changed)
}

/** Marks shared by every character in [start, end); used to show toolbar state. */
export function commonMarks(spans: RichText, start: number, end: number): SpanMarks {
  let position = 0
  let common: SpanMarks | null = null
  for (const span of spans) {
    const from = position
    position += span.text.length
    const overlaps = end > start ? from < end && position > start : from <= start && position >= start
    if (!overlaps || !span.text) continue
    const marks = marksOf(span)
    if (!common) {
      common = marks
      continue
    }
    const shared: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(common)) {
      if (JSON.stringify((marks as Record<string, unknown>)[key]) === JSON.stringify(value)) shared[key] = value
    }
    common = shared as SpanMarks
  }
  return common ?? {}
}

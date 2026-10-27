import { hashRichText } from './document/factory'
import type { RichText, StoreDocument, TextLayer, TextSpan } from './document/schema'
import { normalizeSpans } from './engine/rich-text'
import { hasVisibleText } from './engine/text'

/**
 * Localization bookkeeping: what is translated, what is outdated, and what a
 * translation job should send. Source copy and translations live side by
 * side on each text layer; nothing here overwrites an approved translation.
 */

/** Per-locale translation status counts. */
export type LocaleStatus = {
  locale: string
  total: number
  approved: number
  draft: number
  machine: number
  outdated: number
  missing: number
}

function textLayers(document: StoreDocument): Array<{ slideId: string; layer: TextLayer }> {
  return document.slides.flatMap((slide) =>
    slide.layers
      .filter((layer): layer is TextLayer => layer.type === 'text' && hasVisibleText(layer.content))
      .map((layer) => ({ slideId: slide.id, layer }))
  )
}

/** Status counts for one locale. */
export function localeStatus(document: StoreDocument, locale: string): LocaleStatus {
  const status: LocaleStatus = { locale, total: 0, approved: 0, draft: 0, machine: 0, outdated: 0, missing: 0 }
  for (const { layer } of textLayers(document)) {
    status.total += 1
    const translation = layer.translations[locale]
    if (!translation) {
      status.missing += 1
      continue
    }
    if (translation.sourceHash !== hashRichText(layer.content)) status.outdated += 1
    status[translation.status] += 1
  }
  return status
}

/** One string to translate. */
export type TranslationRequest = { slideId: string; layerId: string; locale: string; source: RichText }

/**
 * Strings a translation job should send. By default it skips approved,
 * up-to-date translations, so re-running never replaces reviewed copy.
 */
export function pendingTranslations(
  document: StoreDocument,
  locales: string[],
  options: { includeApproved?: boolean; includeCurrent?: boolean } = {}
): TranslationRequest[] {
  const requests: TranslationRequest[] = []
  for (const locale of locales) {
    if (locale === document.localization.sourceLocale) continue
    for (const { slideId, layer } of textLayers(document)) {
      const translation = layer.translations[locale]
      // Outdated or missing text is always pending: an approval covered the old source.
      const current = translation !== undefined && translation.sourceHash === hashRichText(layer.content)
      if (current && translation.status === 'approved' && !options.includeApproved) continue
      if (current && translation.status !== 'approved' && !options.includeCurrent) continue
      requests.push({ slideId, layerId: layer.id, locale, source: layer.content })
    }
  }
  return requests
}

/**
 * Encode rich text for a translator: formatted runs become numbered tags,
 * e.g. `Track <1>every</1> workout`, so emphasis survives translation.
 */
export function encodeSpans(spans: RichText): string {
  return spans
    .map((span, index) => {
      const { text, ...marks } = span
      return Object.keys(marks).length ? `<${index}>${text}</${index}>` : text
    })
    .join('')
}

/**
 * Decode a translated string. Tags map back to the original run's marks;
 * malformed or missing tags degrade to plain text in the base style.
 */
export function decodeSpans(translated: string, source: RichText): RichText {
  const spans: TextSpan[] = []
  const pattern = /<(\d+)>([\s\S]*?)<\/\1>/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(translated))) {
    if (match.index > cursor) spans.push({ text: translated.slice(cursor, match.index) })
    const sourceSpan = source[Number(match[1])]
    const { text: _text, ...marks } = sourceSpan ?? { text: '' }
    spans.push({ ...marks, text: match[2] })
    cursor = match.index + match[0].length
  }
  if (cursor < translated.length) spans.push({ text: translated.slice(cursor) })
  return normalizeSpans(spans.map((span) => ({ ...span, text: span.text.replace(/<\/?\d+>/g, '') })))
}

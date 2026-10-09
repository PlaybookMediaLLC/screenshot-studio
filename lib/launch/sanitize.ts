/**
 * Treat fetched source content as untrusted data.
 *
 * A changelog, pull request, or docs page can contain text written for a
 * model rather than a reader: "ignore previous instructions", fake role tags,
 * instructions hidden in HTML comments or invisible Unicode. This module
 * reduces a page to visible text, records what looked like an injection, and
 * fences each source so its content cannot close the fence or impersonate the
 * prompt around it. The prompts tell the model that sources are evidence and
 * never instructions; these steps make that harder to subvert.
 */

const INVISIBLE =
  // Zero-width and joiner characters, word joiner and invisible operators,
  // bidi overrides and isolates, the BOM, and soft hyphens.
  /[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g
// Unicode "tag" characters (U+E0000–U+E007F) can smuggle invisible ASCII text.
const TAG_CHARACTERS = /[\u{E0000}-\u{E007F}]/gu
// Control characters other than tab and newline. Matching them is the point.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g

export function stripInvisible(value: string): string {
  return value.replace(TAG_CHARACTERS, '').replace(INVISIBLE, '').replace(CONTROL, '')
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  rdquo: '”',
  rsquo: '’',
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1]?.toLowerCase() === 'x'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

export type HtmlText = {
  /** Text that was in the page but not visible to a reader. */
  hidden: string
  /** Headings with an id, so a capture can scroll to them (url#id). */
  sections: Array<{ id: string; title: string }>
  text: string
  title: string
}

const SECTION_ID = /^[A-Za-z][\w-]{0,99}$/

const HIDDEN_ELEMENT =
  /<([a-z][a-z0-9]*)\b[^>]*\b(?:hidden|aria-hidden\s*=\s*["']?true["']?|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^"']*["'])[^>]*>([\s\S]*?)<\/\1\s*>/gi

/** Reduce an HTML page to the text a reader would see, keeping hidden text aside. */
export function htmlToText(html: string): HtmlText {
  const hidden: string[] = []
  let value = html
  const title = decodeEntities(value.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const sections: HtmlText['sections'] = []
  for (const match of value.matchAll(
    /<h([1-4])\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/h\1\s*>/gi
  )) {
    const id = match[2]!.trim()
    const heading = stripInvisible(decodeEntities(match[3]!.replace(/<[^>]+>/g, ' ')))
      .replace(/\s+/g, ' ')
      .trim()
    if (SECTION_ID.test(id) && heading && !sections.some((section) => section.id === id)) {
      sections.push({ id, title: heading.slice(0, 120) })
    }
    if (sections.length >= 40) break
  }
  value = value.replace(/<!--([\s\S]*?)-->/g, (_, comment: string) => {
    hidden.push(comment)
    return ' '
  })
  value = value.replace(
    /<(script|style|noscript|template|svg|iframe|object|head)\b[\s\S]*?<\/\1\s*>/gi,
    ' '
  )
  // Repeat for nested hidden blocks.
  for (let pass = 0; pass < 3; pass += 1) {
    value = value.replace(HIDDEN_ELEMENT, (_, _tag: string, inner: string) => {
      hidden.push(inner)
      return ' '
    })
  }
  value = value
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => `\n${'#'.repeat(Number(level))} `)
    .replace(
      /<\/(p|div|section|article|header|footer|li|tr|h[1-6]|ul|ol|table|pre|blockquote)>/gi,
      '\n'
    )
    .replace(/<[^>]+>/g, ' ')
  const clean = (input: string) =>
    stripInvisible(decodeEntities(input))
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  return {
    hidden: clean(hidden.join('\n').replace(/<[^>]+>/g, ' ')),
    sections,
    text: clean(value),
    title: stripInvisible(title),
  }
}

const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|system|your)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|messages?|context)\b/i,
    'asks the model to ignore its instructions',
  ],
  [/\byou are (now|no longer|actually)\b/i, 'tries to reassign the model’s role'],
  [
    /\b(new|updated|real|actual) (system )?(instructions?|prompt|task)\s*:/i,
    'announces new instructions',
  ],
  [
    /(^|\n)\s*(system|assistant|developer|user)\s*(prompt|message)?\s*:/i,
    'contains a chat role label',
  ],
  [
    /<\/?\s*(system|assistant|user|instructions?|source|brief|spec|team_preferences|tool)\b[^>]*>/i,
    'contains prompt markup',
  ],
  [
    /\b(send|email|forward|post|upload|share|exfiltrate|leak)\b[^.\n]{0,60}\b(api[ -]?keys?|passwords?|tokens?|secrets?|credentials|customer (list|data|emails?))\b/i,
    'asks to send sensitive data',
  ],
  [
    /\b(do not|don't|never)\b[^.\n]{0,20}\b(tell|mention|reveal|show)\b[^.\n]{0,20}\b(user|reviewer|human|anyone)\b/i,
    'asks the model to hide something from the reviewer',
  ],
  [/\b(call|use|invoke|run) the [a-z_]*\s*tool\b/i, 'tries to direct tool use'],
  [/\bprint (your|the) (system )?prompt\b/i, 'asks for the system prompt'],
]

export type InjectionFlag = { reason: string; snippet: string }

/** Phrases that read as instructions to a model rather than information for a reader. */
export function detectInjection(value: string): InjectionFlag[] {
  const flags: InjectionFlag[] = []
  for (const [pattern, reason] of INJECTION_PATTERNS) {
    const match = value.match(pattern)
    if (!match || match.index === undefined) continue
    const start = Math.max(0, match.index - 40)
    const snippet = value
      .slice(start, match.index + match[0].length + 40)
      .replace(/\s+/g, ' ')
      .trim()
    flags.push({ reason, snippet: snippet.slice(0, 200) })
  }
  return flags
}

// Tags the surrounding prompt uses. Inside a source they are defused so the
// content cannot close its fence or open a block the prompt would trust.
const FENCE_TAGS =
  /<(\/?)\s*(source|sources|brief|system|instructions?|spec|plan|team_preferences|brand|tool)\b/gi

export function defuseMarkup(value: string): string {
  return value.replace(FENCE_TAGS, '‹$1$2')
}

export type FenceInput = {
  flagged: boolean
  id: string
  kind: string
  text: string
  title: string
  url: string
}

/** Wrap one source as untrusted data the prompt can reference by id. */
export function fenceSource(source: FenceInput): string {
  const attribute = (value: string) => defuseMarkup(value).replace(/["<>]/g, '').slice(0, 300)
  return [
    `<source id="${source.id}" kind="${source.kind}" trust="untrusted" flagged="${source.flagged}" url="${attribute(source.url)}" title="${attribute(source.title)}">`,
    defuseMarkup(source.text),
    `</source>`,
  ].join('\n')
}

/** Clamp text to a character budget at a line or sentence boundary. */
export function clampText(value: string, max: number): string {
  if (value.length <= max) return value
  const slice = value.slice(0, max)
  const cut = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '))
  return `${slice.slice(0, cut > max * 0.6 ? cut + 1 : max).trim()}\n[…truncated]`
}

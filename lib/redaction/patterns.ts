import { z } from 'zod'

/**
 * Sensitive-text detection over OCR words. Pure: words in, findings out.
 *
 * Every finding carries a confidence and a reason. Nothing here is perfect,
 * and the UI says so: people review each suggestion and add what it missed.
 */

/** What kind of sensitive content a finding is. */
export const findingKindSchema = z.enum(['email', 'credential', 'name', 'phone', 'card', 'face'])
/** A finding kind. */
export type FindingKind = z.infer<typeof findingKindSchema>

/** A rectangle as fractions of the screenshot (0-1). */
export type ImageBox = { height: number; width: number; x: number; y: number }

/** One OCR word with its box in image pixels and its 0-100 confidence. */
export type OcrWord = {
  bbox: { x0: number; x1: number; y0: number; y1: number }
  confidence: number
  /** Index of the word's line, so phrases never join across lines. */
  line: number
  text: string
}

/** A suggested redaction. */
export type Finding = {
  box: ImageBox
  /** 0-1: how sure the detector is. */
  confidence: number
  id: string
  kind: FindingKind
  /** Why it was flagged, for the review list (never the sensitive text itself in full). */
  label: string
}

const EMAIL = /^[\w.+%-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}$/i
const CREDENTIAL_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'AWS access key', pattern: /^(AKIA|ASIA)[A-Z0-9]{16}$/ },
  { name: 'GitHub token', pattern: /^(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}$|^github_pat_[A-Za-z0-9_]{40,}$/ },
  { name: 'Slack token', pattern: /^xox[abprs]-[A-Za-z0-9-]{10,}$/ },
  { name: 'Stripe key', pattern: /^(sk|rk|pk)_(live|test)_[A-Za-z0-9]{16,}$/ },
  { name: 'OpenAI-style key', pattern: /^sk-[A-Za-z0-9_-]{20,}$/ },
  { name: 'Google API key', pattern: /^AIza[0-9A-Za-z_-]{35}$/ },
  { name: 'JSON Web Token', pattern: /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/ },
  { name: 'Private key', pattern: /^-{3,}BEGIN([A-Z ]+)?PRIVATE/ },
]
const SECRET_LABEL = /^(api[_-]?key|apikey|token|secret|password|passwd|pwd|auth|bearer|access[_-]?key|client[_-]?secret)[:=]?$/i
const LABELLED_VALUE = /^(api[_-]?key|token|secret|password|passwd|pwd)[:=](.+)$/i
const PHONE = /^\+?\d[\d\s().-]{7,}\d$/
const CARD = /^\d{13,19}$/
const DIGIT_GROUP = /^[+(]?\d[\d().-]*$/

/** Shannon entropy in bits per character: random keys score high, words low. */
export function entropy(value: string): number {
  const counts = new Map<string, number>()
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
  let bits = 0
  for (const count of counts.values()) {
    const p = count / value.length
    bits -= p * Math.log2(p)
  }
  return bits
}

/** True for a card number that passes the Luhn checksum. */
export function luhn(digits: string): boolean {
  let sum = 0
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index])
    if (index % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

const strip = (text: string) => text.replace(/^[("'`[<]+|[)"'`\],.;:>]+$/g, '')

/** What a single token is, if it is sensitive on its own. */
export function classifyToken(text: string): { confidence: number; kind: FindingKind; label: string } | null {
  const token = strip(text)
  if (EMAIL.test(token)) return { confidence: 0.95, kind: 'email', label: 'Email address' }
  for (const { name, pattern } of CREDENTIAL_PATTERNS) {
    if (pattern.test(token)) return { confidence: 0.95, kind: 'credential', label: name }
  }
  const labelled = token.match(LABELLED_VALUE)
  if (labelled && labelled[2]!.length >= 4) return { confidence: 0.85, kind: 'credential', label: 'Secret value' }
  const digits = token.replace(/[\s-]/g, '')
  if (CARD.test(digits) && luhn(digits)) return { confidence: 0.9, kind: 'card', label: 'Card number' }
  if (PHONE.test(token) && token.replace(/\D/g, '').length >= 9) {
    return { confidence: 0.6, kind: 'phone', label: 'Phone number' }
  }
  // Long random-looking strings are likely keys even without a known prefix.
  if (token.length >= 24 && /^[A-Za-z0-9_\-+/=]+$/.test(token) && /\d/.test(token) && entropy(token) >= 4) {
    return { confidence: 0.55, kind: 'credential', label: 'Random-looking token' }
  }
  return null
}

/** Common given names: a capitalised pair starting with one is likely a person. */
const GIVEN_NAMES = new Set(
  (
    'aaron adam adrian ahmed aisha alan albert alex alexander alice alicia amanda amelia amy ana andrea andrew angela anna ' +
    'anthony antonio arjun ashley ava barbara ben benjamin beth brandon brian bruno carla carlos carmen caroline charles ' +
    'charlotte chen chloe chris christian christina christopher claire daniel david deborah diana diego dmitri dylan elena ' +
    'eli elizabeth ella emily emma eric ethan eva fatima felix fernando francesca frank gabriel george grace hannah harry ' +
    'helen henry hiroshi hugo ian isabel isabella jack jacob james jane jason javier jean jennifer jessica joe john jonathan ' +
    'jordan jose joseph joshua juan julia julian justin karen kate katherine kevin kim laura lauren leo liam lily linda ' +
    'lisa lucas lucia luis luke maria mark martin mary matthew maya mei michael michelle mohammed nadia natalie nathan ' +
    'nicholas nicole noah olivia omar oscar pablo patricia paul peter priya rachel rahul raj rebecca richard robert ryan ' +
    'sam samuel sara sarah sebastian sofia sophia stephen steven susan thomas tom victor wei william yuki zoe'
  ).split(' ')
)
/** Capitalised words that are interface text, not names. */
const UI_WORDS = new Set(
  (
    'add all and app apply back cancel close copy create dashboard delete done edit email export file filter help home ' +
    'inbox log login logout menu new next open page password profile save search send settings share sign team the ' +
    'today update upload view welcome your'
  ).split(' ')
)
const CAPITALISED = /^[A-Z][a-z]{1,15}$/

/** A pair of capitalised words that reads like a person's name. */
export function nameConfidence(first: string, last: string): number {
  const a = strip(first)
  const b = strip(last)
  if (!CAPITALISED.test(a) || !CAPITALISED.test(b)) return 0
  if (UI_WORDS.has(a.toLowerCase()) || UI_WORDS.has(b.toLowerCase())) return 0
  return GIVEN_NAMES.has(a.toLowerCase()) ? 0.7 : 0.35
}

function unionBox(words: OcrWord[], width: number, height: number, pad: number): ImageBox {
  const x0 = Math.min(...words.map((word) => word.bbox.x0))
  const y0 = Math.min(...words.map((word) => word.bbox.y0))
  const x1 = Math.max(...words.map((word) => word.bbox.x1))
  const y1 = Math.max(...words.map((word) => word.bbox.y1))
  const padding = (y1 - y0) * pad
  const left = Math.max(0, x0 - padding)
  const top = Math.max(0, y0 - padding)
  return {
    height: (Math.min(height, y1 + padding) - top) / height,
    width: (Math.min(width, x1 + padding) - left) / width,
    x: left / width,
    y: top / height,
  }
}

/**
 * Sensitive text in a screenshot's OCR words: emails, credentials (known
 * key formats, labelled secrets, and random-looking tokens), card numbers,
 * phone numbers, and likely personal names. Boxes are padded so a redaction
 * covers the whole glyphs. OCR confidence lowers a finding's confidence.
 */
export function detectSensitiveText(words: readonly OcrWord[], image: { height: number; width: number }): Finding[] {
  const findings: Finding[] = []
  const add = (kind: FindingKind, label: string, confidence: number, group: OcrWord[]) => {
    const ocr = Math.min(...group.map((word) => word.confidence)) / 100
    findings.push({
      box: unionBox(group, image.width, image.height, 0.25),
      confidence: Math.round(confidence * (0.6 + 0.4 * Math.max(0, Math.min(1, ocr))) * 100) / 100,
      id: `${kind}-${findings.length}`,
      kind,
      label,
    })
  }
  const used = new Set<number>()
  // OCR may split a key at underscores. Join nearby fragments before classifying
  // so the redaction includes the prefix as well as the random-looking suffix.
  words.forEach((word, start) => {
    if (used.has(start) || !/^(?:sk|rk|pk)[_-]|^gh[pousr]_|^github_pat_|^xox[abprs]-/.test(word.text)) return
    const group = [word]
    for (let end = start + 1; end < words.length && end < start + 8; end++) {
      const next = words[end]!
      const previous = group[group.length - 1]!
      if (next.line !== word.line || !/^[A-Za-z0-9_+/=-]+$/.test(next.text) ||
          next.bbox.x0 - previous.bbox.x1 > (word.bbox.y1 - word.bbox.y0) * 0.75) break
      group.push(next)
    }
    const token = classifyToken(group.map((part) => part.text).join(''))
    if (token?.kind === 'credential') {
      add(token.kind, token.label, token.confidence, group)
      group.forEach((_, offset) => used.add(start + offset))
    }
  })
  words.forEach((word, index) => {
    if (used.has(index)) return
    const token = classifyToken(word.text)
    if (token) {
      add(token.kind, token.label, token.confidence, [word])
      used.add(index)
      return
    }
    // "password: hunter22" or "API key  sk-…" spread over two words.
    const next = words[index + 1]
    if (next && next.line === word.line && SECRET_LABEL.test(strip(word.text)) && strip(next.text).length >= 4) {
      add('credential', 'Secret value', 0.8, [next])
      used.add(index + 1)
    }
  })
  // Card and phone numbers OCR as several digit groups on one line.
  for (let start = 0; start < words.length; start++) {
    if (used.has(start) || !DIGIT_GROUP.test(words[start]!.text)) continue
    let end = start
    while (
      end + 1 < words.length &&
      !used.has(end + 1) &&
      words[end + 1]!.line === words[start]!.line &&
      DIGIT_GROUP.test(words[end + 1]!.text)
    ) {
      end++
    }
    if (end === start) continue
    const group = words.slice(start, end + 1)
    const digits = group.map((word) => word.text).join('').replace(/\D/g, '')
    if (CARD.test(digits) && luhn(digits)) add('card', 'Card number', 0.9, group)
    else if (digits.length >= 9 && digits.length <= 15) add('phone', 'Phone number', 0.6, group)
    else continue
    for (let index = start; index <= end; index++) used.add(index)
    start = end
  }
  words.forEach((word, index) => {
    const next = words[index + 1]
    if (!next || next.line !== word.line || used.has(index) || used.has(index + 1)) return
    const confidence = nameConfidence(word.text, next.text)
    if (confidence > 0) {
      add('name', 'Likely personal name', confidence, [word, next])
      used.add(index).add(index + 1)
    }
  })
  return findings
}

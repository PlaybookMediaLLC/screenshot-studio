/**
 * A post's length as X counts it (twitter-text v3): every link is 23
 * characters, most Latin text 1 per character, and everything else (CJK,
 * symbols, emoji) 2, with an emoji sequence (ZWJ, skin tone, flag) counting
 * once. `services/internal/product/x_length.go` counts the same way, so the
 * composer and the backend agree on X's 280.
 *
 * ponytail: links are found by `http(s)://` and `www.` only; twitter-text
 * also links bare domains such as example.com. Add its TLD list if writers
 * paste bare domains.
 */

/** X's length for one link, whatever its real length. */
export const X_LINK_LENGTH = 23

const LINK = /(?:https?:\/\/|www\.)[^\s]+/gi
const TRAILING = /[.,!?;:)'"\]]+$/

/** Code point ranges X counts as one character. */
const LIGHT: [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
]

function isPictographic(code: number): boolean {
  return (
    (code >= 0x1f000 && code <= 0x1faff) ||
    (code >= 0x2600 && code <= 0x27bf) ||
    (code >= 0x2300 && code <= 0x23ff) ||
    (code >= 0x2b00 && code <= 0x2bff)
  )
}

/** Characters that only modify the emoji before them: free. */
function isModifier(code: number): boolean {
  return (
    code === 0xfe0e ||
    code === 0xfe0f ||
    (code >= 0x1f3fb && code <= 0x1f3ff) ||
    (code >= 0xe0020 && code <= 0xe007f) ||
    code === 0x20e3
  )
}

function textLength(text: string): number {
  let length = 0
  let joined = false
  let flag = false
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code === 0x200d) {
      joined = true
      continue
    }
    if (isModifier(code)) continue
    const regional = code >= 0x1f1e6 && code <= 0x1f1ff
    if (regional && flag) {
      // The second letter of a flag.
      flag = false
      continue
    }
    flag = regional
    if ((isPictographic(code) || regional) && joined) {
      joined = false
      continue
    }
    joined = false
    length += LIGHT.some(([from, to]) => code >= from && code <= to) ? 1 : 2
  }
  return length
}

/** The length X gives `text`. */
export function xLength(text: string): number {
  let length = 0
  let last = 0
  for (const match of text.matchAll(LINK)) {
    const link = match[0].replace(TRAILING, '')
    const start = match.index ?? 0
    length += textLength(text.slice(last, start)) + X_LINK_LENGTH
    last = start + link.length
  }
  return length + textLength(text.slice(last))
}

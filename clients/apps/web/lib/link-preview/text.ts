const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Visible characters, keeping combining marks and emoji sequences together. */
export function characterCount(text: string): number {
  return [...segmenter.segment(text)].length
}

/** X v3 weights: https://github.com/twitter/twitter-text/blob/master/config/v3.json. */
export function xCharacterCount(text: string): number {
  let count = 0
  for (const { segment } of segmenter.segment(text.normalize('NFC'))) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment)) {
      count += 2
      continue
    }
    for (const char of segment) {
      const code = char.codePointAt(0)!
      count +=
        code <= 0x10ff ||
        (code >= 0x2000 && code <= 0x200d) ||
        (code >= 0x2010 && code <= 0x201f) ||
        (code >= 0x2032 && code <= 0x2037)
          ? 1
          : 2
    }
  }
  return count
}

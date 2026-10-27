/**
 * Word-level diff for showing a revision before it is applied.
 *
 * A longest-common-subsequence over word tokens (whitespace kept with the
 * word before it), which is plenty for post- and section-sized text. Very
 * long inputs fall back to a whole replacement rather than an O(n·m) table.
 */

export type DiffPart = { text: string; type: 'delete' | 'equal' | 'insert' }

const MAX_TOKENS = 1_500

function tokenize(value: string): string[] {
  return value.match(/\S+\s*|\s+/g) ?? []
}

export function diffWords(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ text: before, type: 'equal' }] : []
  const a = tokenize(before)
  const b = tokenize(after)
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return [
      ...(before ? [{ text: before, type: 'delete' as const }] : []),
      ...(after ? [{ text: after, type: 'insert' as const }] : []),
    ]
  }
  // lengths[i][j] = LCS length of a[i:] and b[j:]
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] =
        a[i]!.trimEnd() === b[j]!.trimEnd()
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!)
    }
  }
  const parts: DiffPart[] = []
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1]
    if (last?.type === type) last.text += text
    else parts.push({ text, type })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i]!.trimEnd() === b[j]!.trimEnd()) {
      push('equal', b[j]!)
      i += 1
      j += 1
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      push('delete', a[i]!)
      i += 1
    } else {
      push('insert', b[j]!)
      j += 1
    }
  }
  while (i < a.length) push('delete', a[i++]!)
  while (j < b.length) push('insert', b[j++]!)
  return parts
}

/** Short "+3 −1 words" summary for a list of changes. */
export function diffStats(parts: DiffPart[]): { added: number; removed: number } {
  const count = (type: DiffPart['type']) =>
    parts
      .filter((part) => part.type === type)
      .reduce((sum, part) => sum + (part.text.match(/\S+/g)?.length ?? 0), 0)
  return { added: count('insert'), removed: count('delete') }
}

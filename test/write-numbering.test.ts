import assert from 'node:assert/strict'
import test from 'node:test'
import { xLength } from '@/lib/content-drafts/x-length'
import { numberingPositionSchema, numberingStyleSchema } from '@/lib/write/document'
import { numberCaptions, numberLabel, threadLabels } from '@/lib/write/numbering'

test('every style labels a post as documented', () => {
  assert.deepEqual(
    numberingStyleSchema.options.map((style) => numberLabel(style, 3, 9)),
    ['#3', '3️⃣', '3.', '3/', '/3', '3/9', '3 of 9']
  )
  assert.equal(numberLabel('emoji', 10, 12), '🔟')
  assert.equal(numberLabel('emoji', 12, 12), '1️⃣2️⃣')
})

test('numbering is off, or a single post, numbers nothing', () => {
  assert.deepEqual(threadLabels(3, undefined), [null, null, null])
  assert.deepEqual(threadLabels(1, { enabled: true, position: 'start', style: 'hash' }), [null])
  assert.deepEqual(threadLabels(3, { enabled: false, position: 'start', style: 'hash' }), [
    null,
    null,
    null,
  ])
})

test('skips leave posts unnumbered and the total counts only numbered posts', () => {
  const numbering = {
    enabled: true,
    position: 'end' as const,
    skipFirst: 1,
    skipLast: 1,
    style: 'fraction' as const,
  }
  assert.deepEqual(threadLabels(5, numbering), [null, '1/3', '2/3', '3/3', null])
  // Skips larger than the thread leave everything unnumbered.
  assert.deepEqual(threadLabels(2, { ...numbering, skipFirst: 3 }), [null, null])
})

test('every position, style and skip combination keeps the authored text and counts the label', () => {
  const captions = ['First', 'Second https://example.com/x', '', 'Fourth 🎉']
  for (const position of numberingPositionSchema.options) {
    for (const style of numberingStyleSchema.options) {
      for (const skipFirst of [0, 1, 2]) {
        for (const skipLast of [0, 1]) {
          const numbering = { enabled: true, position, skipFirst, skipLast, style }
          const labels = threadLabels(captions.length, numbering)
          const numbered = numberCaptions(captions, numbering)
          numbered.forEach((caption, index) => {
            const label = labels[index]
            const original = captions[index]
            if (!label) return assert.equal(caption, original)
            assert.ok(caption.includes(original), `${style} ${position} lost the text`)
            const expected = original
              ? position === 'start'
                ? `${label} ${original}`
                : `${original} ${label}`
              : label
            assert.equal(caption, expected)
            // The label counts toward X's limit: the numbered post is longer.
            assert.ok(xLength(caption) > xLength(original))
          })
        }
      }
    }
  }
})

test('reordering renumbers: labels follow positions, not posts', () => {
  const numbering = { enabled: true, position: 'start' as const, style: 'dot' as const }
  assert.deepEqual(numberCaptions(['b', 'a'], numbering), ['1. b', '2. a'])
  assert.deepEqual(numberCaptions(['a', 'b'], numbering), ['1. a', '2. b'])
})

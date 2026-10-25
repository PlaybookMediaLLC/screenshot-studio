import assert from 'node:assert/strict'
import test from 'node:test'
import { previewExcerpt } from '@/lib/write/preview-text'
import { xLength } from '@/lib/content-drafts/x-length'

test('X preview preserves full transformed URLs and emoji at the weighted cutoff', () => {
  const url = 'https://example.com/' + 'path'.repeat(200)
  const text = 'a'.repeat(250) + ' ' + url
  assert.equal(previewExcerpt(text, 'x'), text)
  const long = text + ' 👩🏽‍💻'.repeat(30)
  const shown = previewExcerpt(long, 'x')
  assert.ok(shown.includes(url))
  assert.ok(xLength(shown) <= 280)
  assert.ok(shown.endsWith('👩🏽‍💻') || shown.endsWith(' '))
  assert.ok(long.startsWith(shown))
  assert.notEqual(shown, long)
  assert.equal(previewExcerpt('界'.repeat(141), 'x'), '界'.repeat(140))
})
test('LinkedIn preview bounds explicit lines without cutting a grapheme; other channels retain text', () => {
  const text = 'one\ntwo\nthree\nfour'
  assert.equal(previewExcerpt(text, 'linkedin'), 'one\ntwo\nthree')
  assert.equal(previewExcerpt('👩🏽‍💻'.repeat(211), 'linkedin'), '👩🏽‍💻'.repeat(210))
  assert.equal(previewExcerpt(text, 'threads'), text)
})

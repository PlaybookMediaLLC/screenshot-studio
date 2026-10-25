import assert from 'node:assert/strict'
import test from 'node:test'
import { xCollapsedText, previewLineLimit, previewText } from '@/lib/write/preview-layout'
import { xLength } from '@/lib/content-drafts/x-length'

test('X preview preserves full transformed URLs and emoji at the weighted cutoff', () => {
  const url = 'https://example.com/' + 'path'.repeat(200)
  const text = 'a'.repeat(250) + ' ' + url
  assert.equal(xCollapsedText(text), text)
  const long = text + ' 👩🏽‍💻'.repeat(30)
  const shown = xCollapsedText(long)
  assert.ok(shown.includes(url))
  assert.ok(xLength(shown) <= 280)
  assert.ok(shown.endsWith('👩🏽‍💻') || shown.endsWith(' '))
  assert.ok(long.startsWith(shown))
  assert.notEqual(shown, long)
  assert.equal(xCollapsedText('界'.repeat(141)), '界'.repeat(140))
})
test('LinkedIn keeps complete text for its three rendered lines; ordinary threads stay uncollapsed', () => {
  const text = 'one\ntwo\nthree\nfour'
  assert.equal(previewLineLimit('linkedin', text), 3)
  assert.equal(previewText(text), text)
  assert.equal(previewLineLimit('threads', text), null)
  assert.equal(previewText('@[Shots](urn:li:organization:123)'), 'Shots')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDraftCSV } from '@/lib/write/bulk-import'

test('CSV preserves multiline captions, Unicode, literal formulas, and escaped quotes', () => {
  assert.deepEqual(
    parseDraftCSV(
      '\uFEFFcaption,asset,channels\r\n"Hello, ""team""\n🚀",design.png,x;linkedin\r\n=SUM(1),,x'
    ),
    [
      { caption: 'Hello, "team"\n🚀', asset: 'design.png', channels: ['x', 'linkedin'] },
      { caption: '=SUM(1)', asset: '', channels: ['x'] },
    ]
  )
})
test('CSV rejects malformed input and accepts exactly fifty rows', () => {
  for (const text of [
    'caption\n"unfinished',
    'caption,caption\na,b',
    'caption,unknown\na,b',
    'caption,asset\none',
    'caption\n"a"b',
    'caption',
  ])
    assert.throws(() => parseDraftCSV(text))
  assert.equal(parseDraftCSV('caption\n' + Array(50).fill('item').join('\n')).length, 50)
  assert.throws(() => parseDraftCSV('caption\n' + Array(51).fill('item').join('\n')), /50/)
})

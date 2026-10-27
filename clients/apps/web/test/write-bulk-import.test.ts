import assert from 'node:assert/strict'
import test from 'node:test'
import { channelProblem, parseDraftCSV } from '@/lib/write/bulk-import'

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
test('IMPORT-01: review flags unknown and unconnected channels, never unassigned rows', () => {
  const [unknown, unconnected, unassigned, connected] = parseDraftCSV(
    'caption,asset,channels\nA,,not-a-channel\nB,,x\nC,,\nD,,LinkedIn'
  )
  assert.match(
    channelProblem(unknown.channels, ['linkedin']) ?? '',
    /Unknown channel not-a-channel/
  )
  assert.match(channelProblem(unconnected.channels, ['linkedin']) ?? '', /No connected x account/)
  assert.equal(channelProblem(unassigned.channels, []), undefined)
  assert.equal(channelProblem(connected.channels, ['linkedin']), undefined)
})

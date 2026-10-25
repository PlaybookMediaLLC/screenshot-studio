import assert from 'node:assert/strict'
import test from 'node:test'
import { splitThread } from '@/lib/write/split-thread'
import { postBreak } from '@/lib/write/versions'
import { serializeDraft } from '@/lib/content-drafts/serialize'
import { searchEmoji } from '@shots/platejs-editor/lib'

const p = (text: string) => ({ type: 'p', children: [{ text }] })
const leaves = (nodes: unknown[]): string =>
  nodes
    .map((raw) => {
      const node = raw as { text?: string; children?: unknown[] }
      return node.text ?? leaves(node.children ?? [])
    })
    .join('')

test('TF-016/058: splitting preserves marks, whitespace, links and media without mutating the draft', () => {
  const source = [
    postBreak(),
    {
      type: 'p',
      children: [
        { text: 'Opening bold paragraph. '.repeat(8), bold: true },
        {
          type: 'a',
          url: 'https://example.com/a/long/path',
          children: [{ text: 'Source document', italic: true }],
        },
        { text: '\n\tEnding with emoji 👩🏽‍💻 and unusual\u00a0whitespace. '.repeat(5), italic: true },
      ],
    },
    {
      type: 'img',
      assetId: 'asset-1',
      url: 'https://example.com/image.png',
      children: [{ text: '' }],
    },
  ]
  const before = structuredClone(source)
  const result = splitThread(source, 'x', 140)
  assert.deepEqual(source, before)
  assert.equal(leaves(result), leaves(source))
  assert.equal(result.filter((node) => node.type === 'img').length, 1)
  const serialized = serializeDraft(result, 'x', undefined, undefined, { limit: 140 })
  assert.ok(serialized.posts.length > 1)
  assert.ok(serialized.posts.every((post) => post.length <= 140))
  assert.equal(
    serialized.posts.filter((post) => post.caption.includes('https://example.com/a/long/path'))
      .length,
    1
  )
  assert.ok(JSON.stringify(result).includes('"bold":true'))
  assert.ok(JSON.stringify(result).includes('"italic":true'))
})

test('TF-020/063/075: splitting reserves numbering space and repeated serialization never duplicates numbers', () => {
  const numbering = { enabled: true, style: 'fraction', position: 'end' } as const
  const result = splitThread(
    [postBreak(), p('Words with a URL https://example.com/very-long-url '.repeat(10))],
    'x',
    100,
    numbering
  )
  const first = serializeDraft(result, 'x', undefined, undefined, { limit: 100, numbering })
  const again = serializeDraft(result, 'x', undefined, undefined, { limit: 100, numbering })
  assert.deepEqual(first, again)
  assert.ok(first.posts.every((post) => post.length <= 100))
  assert.ok(!leaves(result).includes('1/'))
})

test('TF-016: unbroken text splits by whole grapheme and oversized atomic blocks fail without losing text', () => {
  const original = '👩🏽‍💻'.repeat(100)
  const result = splitThread([p(original)], 'x', 25)
  assert.equal(leaves(result), original)
  for (const post of serializeDraft(result, 'x').posts) assert.ok(/^(👩🏽‍💻)+$/.test(post.caption))
  assert.throws(() => splitThread([p('text '.repeat(1000))], 'x', 25), /more than 25/)
  assert.throws(
    () => splitThread([{ type: 'h4', children: [{ text: 'x'.repeat(300) }] }], 'x', 25),
    /Split that block manually/
  )
})

test('TF-050: emoji search uses the same names and aliases as the rich editor', () => {
  assert.equal(searchEmoji(':rocket:')[0]?.native, '🚀')
  assert.ok(searchEmoji('  ROCKET ').some((emoji) => emoji.native === '🚀'))
  assert.deepEqual(searchEmoji('no-such-emoji-xyz'), [])
})

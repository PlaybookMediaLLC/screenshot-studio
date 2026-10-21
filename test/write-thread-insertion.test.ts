import assert from 'node:assert/strict'
import test from 'node:test'
import type { Value } from '@shots/platejs-editor/platejs'
import { createPlateEditor } from '@shots/platejs-editor/platejs/react'
import {
  deletePost,
  insertPostBreak,
  movePost,
  PostBreakPlugin,
  postRanges,
  splitPostAtCaret,
} from '@/components/drafts/thread'
import { postBreak } from '@/lib/write/versions'
import { POST_BREAK } from '@/lib/content-drafts/serialize'

const p = (text = '') => ({ type: 'p', children: [{ text }] })

test('moving then deleting a post preserves the other post and its identity', () => {
  const first = postBreak()
  const second = postBreak()
  const editor = createPlateEditor({
    plugins: [PostBreakPlugin],
    value: [first, p('A'), second, p('B')] as Value,
  })
  movePost(editor, 2, 1)
  assert.equal(editor.children[0].id, second.id)
  assert.equal(editor.api.string([1]), 'B')
  assert.equal(editor.children[2].id, first.id)
  deletePost(editor, 2)
  assert.equal(editor.children[0].id, second.id)
  assert.equal(editor.api.string([1]), 'B')
  assert.equal(postRanges(editor.children).length, 1)
})

test('splitting at a word boundary removes the new post’s leading space', () => {
  const editor = createPlateEditor({
    plugins: [PostBreakPlugin],
    value: [postBreak(), p('First second')],
  })
  editor.tf.select({ path: [1, 0], offset: 5 })
  splitPostAtCaret(editor)
  assert.equal(editor.api.string([1]), 'First')
  assert.equal(editor.api.string([3]), 'second')
  assert.deepEqual(editor.selection?.anchor, { path: [3, 0], offset: 0 })
})

for (const selected of [null, [0, 0], [1, 0]]) {
  test(`add post keeps both headers and focuses the new paragraph from ${JSON.stringify(selected)}`, () => {
    const editor = createPlateEditor({ plugins: [PostBreakPlugin], value: [postBreak(), p()] })
    if (selected) editor.tf.select({ path: selected, offset: 0 })
    insertPostBreak(editor)
    assert.deepEqual(
      editor.children.map((node) => node.type),
      [POST_BREAK, 'p', POST_BREAK, 'p']
    )
    assert.deepEqual(editor.selection?.anchor, { path: [3, 0], offset: 0 })
  })
}

test('add post inserts after the whole current post, preserving its remaining paragraphs', () => {
  const editor = createPlateEditor({
    plugins: [PostBreakPlugin],
    value: [postBreak(), p('One'), p('Still one'), postBreak(), p('Two')],
  })
  editor.tf.select({ path: [1, 0], offset: 1 })
  insertPostBreak(editor)
  assert.deepEqual(postRanges(editor.children), [
    [0, 3],
    [3, 5],
    [5, 7],
  ])
  assert.equal(editor.api.string([2]), 'Still one')
  assert.equal(editor.api.string([6]), 'Two')
  assert.deepEqual(editor.selection?.anchor, { path: [4, 0], offset: 0 })
})

for (const selected of ['all', 'header'] as const) {
  test(`typing into ${selected} replaces text without leaving the selection in a header`, () => {
    const editor = createPlateEditor({
      plugins: [PostBreakPlugin],
      value: [postBreak(), p(selected === 'all' ? 'Old text' : '')],
    })
    editor.tf.select(selected === 'all' ? editor.api.range([]) : { path: [0, 0], offset: 0 })
    editor.tf.insertText('Replacement 🚀')
    assert.deepEqual(
      editor.children.map((node) => node.type),
      [POST_BREAK, 'p']
    )
    assert.equal(editor.api.string([1]), 'Replacement 🚀')
    assert.equal(editor.selection?.anchor.path[0], 1)
  })
}

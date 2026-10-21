import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlateEditor } from '@shots/platejs-editor/platejs/react'
import { insertPostBreak, PostBreakPlugin, postRanges } from '@/components/drafts/thread'
import { postBreak } from '@/lib/write/versions'
import { POST_BREAK } from '@/lib/content-drafts/serialize'

const p = (text = '') => ({ type: 'p', children: [{ text }] })

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

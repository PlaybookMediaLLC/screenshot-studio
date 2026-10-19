import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeConcurrent,
  mergeSetConcurrent,
  ConcurrentEditError,
} from '@/lib/creative-sets/concurrent'
import { applySetCommand } from '@/lib/creative-sets/commands'
import { createCreativeSet } from '@/lib/creative-sets/recipes'
import { SetHistory } from '@/lib/creative-sets/history'

const fixture = () =>
  createCreativeSet({
    headline: 'Original',
    supporting: '',
    treatment: 'detail-spotlight',
    source: {
      id: 'source',
      revision: 1,
      src: 'asset:11111111-1111-4111-8111-111111111111',
      name: 'screen',
      width: 1440,
      height: 900,
    },
    focus: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
  })

test('stable layers merge unrelated edits, additions and reorder; delete/change refuses', () => {
  const base = [
    { id: 'a', text: 'a' },
    { id: 'b', text: 'b' },
  ]
  assert.deepEqual(
    mergeConcurrent(
      base,
      [
        { id: 'b', text: 'b' },
        { id: 'a', text: 'local' },
      ],
      [...base, { id: 'c', text: 'peer' }]
    ),
    [
      { id: 'b', text: 'b' },
      { id: 'c', text: 'peer' },
      { id: 'a', text: 'local' },
    ]
  )
  assert.throws(
    () => mergeConcurrent(base, [base[1]], [{ id: 'a', text: 'peer' }, base[1]]),
    ConcurrentEditError
  )
  assert.throws(
    () => mergeConcurrent({ text: 'a' }, { text: 'b' }, { text: 'c' }),
    ConcurrentEditError
  )
})

test('a simultaneous shared headline and local override preserve both authorities', () => {
  const base = fixture()
  const local = applySetCommand(base, {
    type: 'output-copy',
    outputId: base.outputs[2]!.id,
    field: 'headline',
    value: 'Short local',
  })
  const peer = applySetCommand(base, {
    type: 'story-copy',
    storyId: base.stories[0]!.id,
    field: 'headline',
    value: 'Shared update',
  })
  const merged = mergeSetConcurrent(base, local, peer)
  assert.deepEqual(
    merged.outputs.map((output) => output.document.texts[0]!.text),
    ['Shared update', 'Shared update', 'Short local']
  )
  assert.equal(merged.outputs[2]!.overrides.headline, true)
  assert.equal(merged.outputs[2]!.review.wording, true)
  assert.deepEqual(mergeSetConcurrent(merged, merged, merged), merged)
})

test('undo preserves peer edits and refuses an overlapping later edit without consuming history', () => {
  const base = fixture(),
    history = new SetHistory(base)
  history.commit(
    applySetCommand(base, {
      type: 'story-copy',
      storyId: base.stories[0]!.id,
      field: 'headline',
      value: 'Mine',
    })
  )
  history.document = applySetCommand(history.document, {
    type: 'story-copy',
    storyId: base.stories[0]!.id,
    field: 'supporting',
    value: 'Peer detail',
  })
  assert.equal(history.undo().stories[0]!.supporting, 'Peer detail')
  history.redo()
  history.document = applySetCommand(history.document, {
    type: 'story-copy',
    storyId: base.stories[0]!.id,
    field: 'headline',
    value: 'Peer replacement',
  })
  assert.throws(() => history.undo(), ConcurrentEditError)
  assert.equal(history.canUndo, true)
  assert.equal(history.document.stories[0]!.headline, 'Peer replacement')
})

test('upload reference normalization preserves undo and redo of local image edits', () => {
  const base = fixture(),
    history = new SetHistory(base)
  const edited = structuredClone(base)
  edited.outputs[0]!.overrides.source = true
  edited.outputs[0]!.document.image.src = 'blob:local-edit'
  history.commit(edited)
  const ref = 'asset:22222222-2222-4222-8222-222222222222'
  history.normalizeAssets((document) => {
    const next = structuredClone(document)
    for (const output of next.outputs)
      if (output.document.image.src === 'blob:local-edit') output.document.image.src = ref
    return next
  })
  assert.deepEqual(history.undo(), base)
  assert.equal(history.redo().outputs[0]!.document.image.src, ref)
})

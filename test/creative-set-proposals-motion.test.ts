import assert from 'node:assert/strict'
import test from 'node:test'
import { applyStoryProposal, storyProposalRequestSchema } from '@/lib/creative-sets/proposals'
import { applyStoryMotion } from '@/lib/creative-sets/motion'
import { createCreativeSet } from '@/lib/creative-sets/recipes'
import { applySetCommand } from '@/lib/creative-sets/commands'
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

test('a kept copy proposal updates the requested scope as one undo; invalid targets cannot apply', () => {
  let base = fixture()
  base = applySetCommand(base, {
    type: 'output-copy',
    outputId: base.outputs[2]!.id,
    field: 'headline',
    value: 'Local',
  })
  const request = storyProposalRequestSchema.parse({
    creativeSetId: 'c1234567890123456789012345',
    baseRevision: 1,
    storyId: base.stories[0]!.id,
    outputId: base.outputs[0]!.id,
    scope: 'story',
    facts: 'Members review all pending decisions in one place.',
  })
  const proposal = {
    headline: 'Pending decisions, together',
    supporting: 'One shared list',
    reason: 'Clear benefit',
  }
  const history = new SetHistory(base)
  history.commit(applyStoryProposal(base, request, proposal))
  assert.equal(history.document.stories[0]!.supporting, proposal.supporting)
  assert.equal(history.document.outputs[2]!.document.texts[0]!.text, 'Local')
  assert.deepEqual(history.undo(), base)
  const local = applyStoryProposal(base, { ...request, scope: 'output' }, proposal)
  assert.equal(local.stories[0]!.headline, 'Original')
  assert.equal(local.outputs[0]!.overrides.headline, true)
  assert.throws(() => applyStoryProposal(base, { ...request, storyId: 'missing' }, proposal))
  assert.throws(() => applyStoryProposal(base, request, { ...proposal, headline: '' }))
})

test('motion recipes remain native and reversible; custom tracks are preserved or explicitly conflict', () => {
  const base = fixture(),
    id = base.outputs[0]!.id
  for (const name of ['proof-reveal', 'gentle-pan', 'clean-entrance'] as const) {
    const history = new SetHistory(base)
    history.commit(applyStoryMotion(base, id, name))
    assert.ok(history.document.outputs[0]!.document.timeline!.layerTracks!.length > 0)
    assert.deepEqual(history.undo(), base)
    assert.equal(
      applyStoryMotion(history.redo(), id, 'none').outputs[0]!.document.timeline!.layerTracks!
        .length,
      0
    )
  }
  const animated = applyStoryMotion(base, id, 'gentle-pan')
  const custom = animated.outputs[0]!.document.timeline!.layerTracks![0]!
  custom.id = 'custom-track'
  assert.throws(() => applyStoryMotion(animated, id, 'gentle-pan'), /custom x animation/)
  const reveal = applyStoryMotion(animated, id, 'proof-reveal')
  assert.deepEqual(
    reveal.outputs[0]!.document.timeline!.layerTracks!.find((track) => track.id === 'custom-track'),
    custom
  )
})

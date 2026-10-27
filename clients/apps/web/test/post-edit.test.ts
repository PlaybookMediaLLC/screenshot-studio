import assert from 'node:assert/strict'
import test from 'node:test'
import {
  editResetsApproval,
  postEditBlock,
  postFields,
  postLength,
  resolvePostConflict,
  samePostFields,
  saveStateFor,
} from '@/lib/launch/post-edit'
import { campaignPostUpdateSchema } from '@/lib/tenant/schemas'

const theirs = { callToAction: 'Try it', copy: 'Their copy', status: 'DRAFT' as const, title: '' }
const mine = { callToAction: '', copy: 'My copy', title: 'Mine' }

test('live scheduled and published posts cannot be edited; the rest can', () => {
  assert.equal(postEditBlock('PUBLISHED', false), 'Published posts can no longer be edited.')
  assert.equal(postEditBlock('SCHEDULED', false), 'Cancel the schedule to edit this post.')
  // A cancelled or failed delivery is editable and goes back to draft.
  assert.equal(postEditBlock('SCHEDULED', true), null)
  for (const status of [
    'DRAFT',
    'NEEDS_CHANGES',
    'REJECTED',
    'READY_FOR_REVIEW',
    'APPROVED',
  ] as const) {
    assert.equal(postEditBlock(status, false), null)
  }
  assert.equal(editResetsApproval('APPROVED'), true)
  assert.equal(editResetsApproval('READY_FOR_REVIEW'), false)
})

test('a save result becomes the indicator or a decision for the author', () => {
  assert.deepEqual(saveStateFor({ outcome: 'saved', post: theirs }), { kind: 'saved' })
  assert.deepEqual(saveStateFor({ outcome: 'stale', post: theirs }), {
    kind: 'stale',
    theirs,
  })
  const matches = [{ matchMode: 'word' as const, reason: 'Legal', term: 'guaranteed' }]
  assert.deepEqual(saveStateFor({ matches, outcome: 'prohibited' }), {
    kind: 'prohibited',
    matches,
  })
})

test('a conflict keeps both versions: reload takes theirs, keep bases mine on theirs', () => {
  assert.deepEqual(resolvePostConflict('reload', mine, theirs), {
    draft: { callToAction: 'Try it', copy: 'Their copy', title: '' },
    expectedCopy: 'Their copy',
  })
  assert.deepEqual(resolvePostConflict('keep', mine, theirs), {
    draft: mine,
    expectedCopy: 'Their copy',
  })
})

test('post fields compare without nulls and count copy plus call to action', () => {
  const fields = postFields({ callToAction: null, copy: 'Hi', title: null })
  assert.deepEqual(fields, { callToAction: '', copy: 'Hi', title: '' })
  assert.equal(samePostFields(fields, { ...fields }), true)
  assert.equal(samePostFields(fields, { ...fields, title: 'x' }), false)
  assert.equal(postLength('Hello', 'Try it'), 12)
  assert.equal(postLength('Hello', null), 5)
})

test('an edit carries the copy it was made against and never blank copy', () => {
  assert.equal(
    campaignPostUpdateSchema.safeParse({ copy: 'New', expectedCopy: 'Old' }).success,
    true
  )
  assert.equal(campaignPostUpdateSchema.safeParse({ copy: 'New' }).success, false)
  assert.equal(
    campaignPostUpdateSchema.safeParse({ copy: '  ', expectedCopy: 'Old' }).success,
    false
  )
  assert.equal(
    campaignPostUpdateSchema.safeParse({ callToAction: '', expectedCopy: 'Old' }).success,
    true
  )
})

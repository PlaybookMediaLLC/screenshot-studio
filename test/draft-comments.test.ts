import assert from 'node:assert/strict'
import test from 'node:test'
import { draftCommentInputSchema } from '../packages/screenshot-studio-backend-sdk/src/draft-comments'

const add = { action: 'add', baseVersion: 1, commentId: 'comment-1', text: 'Please review.' }

test('comment commands reject content edits, forged authors, timestamps and invalid action fields', () => {
  assert.deepEqual(draftCommentInputSchema.parse(add), add)
  for (const extra of [
    { body: [] },
    { userId: 'someone' },
    { createdAt: '2026-10-21' },
    { resolved: true },
  ]) {
    assert.equal(draftCommentInputSchema.safeParse({ ...add, ...extra }).success, false)
  }
  for (const input of [
    { ...add, baseVersion: 0 },
    { ...add, text: '  ' },
    { ...add, text: 'x'.repeat(5001) },
    { action: 'edit', baseVersion: 1, commentId: 'a', text: 'Missing thread' },
    { action: 'resolve', baseVersion: 1, threadId: 't' },
    { action: 'delete', baseVersion: 1, threadId: 't', commentId: 'a', text: 'Unexpected text' },
  ]) {
    assert.equal(draftCommentInputSchema.safeParse(input).success, false)
  }
})

test('comment commands keep explicit mention identities and thread targets', () => {
  const reply = { ...add, threadId: 'thread-1', mentionUserIds: ['user-1'] }
  assert.deepEqual(draftCommentInputSchema.parse(reply), reply)
  assert.deepEqual(
    draftCommentInputSchema.parse({
      action: 'resolve',
      baseVersion: 2,
      threadId: 'thread-1',
      resolved: false,
    }),
    { action: 'resolve', baseVersion: 2, threadId: 'thread-1', resolved: false }
  )
})

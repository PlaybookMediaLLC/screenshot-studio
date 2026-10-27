import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeDiscussions, readDiscussions } from '@/lib/content-drafts/discussions'

const thread = (id: string, text: string) => ({
  comments: [
    {
      contentRich: [{ children: [{ text }], type: 'p' }],
      createdAt: '2026-10-18T10:00:00.000Z',
      id: `c-${id}`,
      userId: 'u1',
    },
  ],
  createdAt: '2026-10-18T09:00:00.000Z',
  id,
  isResolved: false,
  userId: 'u1',
})

test('stored threads come back with dates and unknown fields intact', () => {
  const read = readDiscussions({
    threads: [thread('t1', 'Tighten this'), { id: 'broken' }],
    users: { u1: { id: 'u1', name: 'Ada' } },
  })
  assert.equal(read.threads.length, 1)
  assert.ok(read.threads[0].createdAt instanceof Date)
  assert.ok(read.threads[0].comments[0].createdAt instanceof Date)
  assert.deepEqual(read.threads[0].comments[0].contentRich, [
    { children: [{ text: 'Tighten this' }], type: 'p' },
  ])
  assert.equal(read.users.u1.name, 'Ada')
  assert.deepEqual(readDiscussions(null), { threads: [], users: {} })
  assert.deepEqual(readDiscussions('nonsense'), { threads: [], users: {} })
})

test('a peer’s threads survive a merge, and ours win on the same id', () => {
  const ours = readDiscussions({
    threads: [thread('t1', 'mine, edited'), thread('t2', 'mine')],
    users: { u1: { id: 'u1', name: 'Ada' } },
  })
  const theirs = readDiscussions({
    threads: [thread('t1', 'old'), thread('t3', 'peer')],
    users: { u2: { id: 'u2', name: 'Bea' } },
  })
  const merged = mergeDiscussions(ours, theirs)
  assert.deepEqual(merged.threads.map((item) => item.id).sort(), ['t1', 't2', 't3'])
  const t1 = merged.threads.find((item) => item.id === 't1')
  assert.deepEqual(t1?.comments[0].contentRich, [
    { children: [{ text: 'mine, edited' }], type: 'p' },
  ])
  assert.deepEqual(Object.keys(merged.users).sort(), ['u1', 'u2'])
})

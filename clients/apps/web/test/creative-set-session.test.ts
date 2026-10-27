import assert from 'node:assert/strict'
import test from 'node:test'
import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'
import { createCreativeSet } from '@/lib/creative-sets/recipes'
import { CreativeSetSession } from '@/lib/creative-sets/session'
import { applySetCommand } from '@/lib/creative-sets/commands'
import { mergeNativeDelta } from '@/lib/creative-sets/native-session'
import type { SetRecovery } from '@/lib/creative-sets/recovery'

function fixture() {
  const document = createCreativeSet({
    headline: 'First',
    supporting: '',
    treatment: 'product-hero',
    source: {
      id: 'source',
      revision: 1,
      src: 'asset:11111111-1111-4111-8111-111111111111',
      name: 'screen.png',
      width: 1440,
      height: 900,
    },
    focus: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
  })
  const writes: { baseRevision: number; document: unknown }[] = [],
    drafts: SetRecovery[] = []
  const remote = { revision: 1, document }
  const fake = { failure: null as unknown, wait: null as Promise<void> | null }
  const client = {
    creativeSet: {
      get: { query: async () => remote },
      updateDocument: {
        mutate: async (input: { baseRevision: number; document: typeof document }) => {
          writes.push(input)
          await fake.wait
          if (fake.failure) throw fake.failure
          if (input.baseRevision !== remote.revision)
            throw Object.assign(new Error('Revision conflict'), { data: { code: 'CONFLICT' } })
          remote.document = input.document
          remote.revision = input.baseRevision + 1
          return { revision: remote.revision }
        },
      },
    },
  } as unknown as TRPCClient<AppRouter>
  const session = new CreativeSetSession(
    {
      id: 'c123456789012345678901234',
      name: 'Set',
      organizationId: 'workspace',
      revision: 1,
      document,
    },
    client,
    {
      write: async (record) => {
        drafts.push(record)
      },
      remove: async () => {},
    }
  )
  return { session, fake, writes, remote, drafts, document }
}

test('autosave is serialized and edits during a write survive with the next base revision', async () => {
  const { session, fake, writes } = fixture()
  try {
    let release!: () => void
    fake.wait = new Promise<void>((resolve) => {
      release = resolve
    })
    session.command({
      type: 'story-copy',
      storyId: session.snapshot().document.stories[0]!.id,
      field: 'headline',
      value: 'Second',
    })
    const save = session.save()
    session.command({
      type: 'story-copy',
      storyId: session.snapshot().document.stories[0]!.id,
      field: 'headline',
      value: 'Third',
    })
    release()
    await save
    fake.wait = null
    assert.equal(session.snapshot().document.stories[0]!.headline, 'Third')
    assert.equal(session.snapshot().revision, 2)
    await session.save()
    assert.deepEqual(
      writes.map((write) => write.baseRevision),
      [1, 2]
    )
    assert.equal(session.snapshot().status, 'saved')
    await session.save()
    assert.equal(writes.length, 2, 'unchanged documents do not save')
  } finally {
    session.dispose()
  }
})

test('a stale write stops further saves; local changes remain undoable', async () => {
  const { session, fake, writes, remote, document } = fixture()
  try {
    remote.document = applySetCommand(document, {
      type: 'story-copy',
      storyId: document.stories[0]!.id,
      field: 'headline',
      value: 'Theirs',
    })
    remote.revision = 2
    fake.failure = { data: { code: 'CONFLICT' } }
    session.command({
      type: 'story-copy',
      storyId: session.snapshot().document.stories[0]!.id,
      field: 'headline',
      value: 'Mine',
    })
    await session.save()
    assert.equal(session.snapshot().status, 'conflict')
    session.command({
      type: 'story-copy',
      storyId: session.snapshot().document.stories[0]!.id,
      field: 'headline',
      value: 'Still mine',
    })
    await session.save()
    assert.equal(writes.length, 1)
    session.undo()
    assert.equal(session.snapshot().document.stories[0]!.headline, 'Mine')
  } finally {
    session.dispose()
  }
})

test('a lost save response is reconciled without overwriting a newer document', async () => {
  const { session, fake, remote, writes } = fixture()
  try {
    session.command({
      type: 'story-copy',
      storyId: session.snapshot().document.stories[0]!.id,
      field: 'headline',
      value: 'Already stored',
    })
    remote.document = session.snapshot().document
    remote.revision = 2
    fake.failure = { data: { code: 'CONFLICT' } }
    assert.equal(await session.save(), true)
    assert.equal(session.snapshot().revision, 2)
    assert.equal(writes.length, 1)
  } finally {
    session.dispose()
  }
})

test('recovery based on a stale revision never starts an automatic overwrite', async () => {
  const { session, writes, document } = fixture()
  try {
    session.recover({
      key: 'another-tab',
      workspaceId: 'workspace',
      setId: session.record.id,
      tabId: 'other',
      revision: 9,
      updatedAt: Date.now(),
      document: { ...document, stories: [{ ...document.stories[0]!, headline: 'Recovered' }] },
    })
    assert.equal(session.snapshot().status, 'conflict')
    await session.save()
    assert.equal(writes.length, 0)
  } finally {
    session.dispose()
  }
})

test('native edits keep untouched fractional geometry, hidden layers and layer identity', () => {
  const original = {
    texts: [
      { id: 'a', fontSize: 0.03456, text: 'First', visible: false },
      { id: 'b', fontSize: 0.05678, text: 'Second' },
    ],
    image: { src: 'asset:one' },
  }
  const baseline = {
    texts: [
      { id: 'a', fontSize: 0.035, text: 'First', visible: false },
      { id: 'b', fontSize: 0.057, text: 'Second' },
    ],
    image: { src: 'asset:one', scale: 100 },
  }
  const next = structuredClone(baseline)
  next.texts.reverse()
  next.texts[0]!.text = 'Edited'
  assert.deepEqual(mergeNativeDelta(original, baseline, next), {
    ...original,
    texts: [{ ...original.texts[1], text: 'Edited' }, original.texts[0]],
  })
  assert.equal(
    mergeNativeDelta(original, baseline, baseline),
    original,
    'selection and loading do not create a transaction'
  )
})

test('remote refresh merges a peer field; undo only reverses the local transaction', async () => {
  const { session, remote, document } = fixture()
  try {
    session.command({
      type: 'story-copy',
      storyId: document.stories[0]!.id,
      field: 'headline',
      value: 'Mine',
    })
    remote.document = applySetCommand(document, {
      type: 'story-copy',
      storyId: document.stories[0]!.id,
      field: 'supporting',
      value: 'Theirs',
    })
    remote.revision = 2
    await session.refreshRemote()
    assert.equal(session.snapshot().document.stories[0]!.headline, 'Mine')
    assert.equal(session.snapshot().document.stories[0]!.supporting, 'Theirs')
    session.undo()
    assert.equal(session.snapshot().document.stories[0]!.headline, 'First')
    assert.equal(session.snapshot().document.stories[0]!.supporting, 'Theirs')
    session.redo()
    assert.equal(session.snapshot().document.stories[0]!.headline, 'Mine')
    await session.save()
    assert.equal(remote.document.stories[0]!.supporting, 'Theirs')
  } finally {
    session.dispose()
  }
})

test('an invalid pending native edit blocks cloud save until the user corrects it', async () => {
  const { session, writes } = fixture()
  try {
    session.editorFailure('Invalid layer')
    assert.equal(await session.save(), false)
    assert.equal(writes.length, 0)
    assert.equal(session.snapshot().status, 'error')
    session.editorFailure(null)
    assert.equal(await session.save(), true)
  } finally {
    session.dispose()
  }
})

test('simultaneous saves merge independent fields and retry against the current revision', async () => {
  const { session, remote, document, writes } = fixture()
  try {
    session.command({
      type: 'story-copy',
      storyId: document.stories[0]!.id,
      field: 'headline',
      value: 'Mine',
    })
    remote.document = applySetCommand(document, {
      type: 'story-copy',
      storyId: document.stories[0]!.id,
      field: 'supporting',
      value: 'Peer detail',
    })
    remote.revision = 2
    assert.equal(await session.save(), true)
    assert.deepEqual(
      writes.map((write) => write.baseRevision),
      [1, 2]
    )
    assert.equal(remote.document.stories[0]!.headline, 'Mine')
    assert.equal(remote.document.stories[0]!.supporting, 'Peer detail')
    session.undo()
    assert.equal(session.snapshot().document.stories[0]!.supporting, 'Peer detail')
  } finally {
    session.dispose()
  }
})

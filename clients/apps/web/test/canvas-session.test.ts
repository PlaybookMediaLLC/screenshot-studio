import assert from 'node:assert/strict'
import test from 'node:test'
import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'
import { CanvasSession, mergeCanvasConcurrent, type CanvasRecovery } from '@/lib/canvas/session'
import { applyCanvasCommand } from '@/lib/canvas/commands'
import { canvasDocumentSchema, type CanvasDocument } from '@/lib/canvas/document'
import { blankArtboard } from '@/lib/canvas/recipes'
import { ConcurrentEditError } from '@/lib/creative-sets/concurrent'
import { pendingStageSize } from '@/lib/design/apply'

function fixture() {
  let next = 0
  const newId = () => `board-${++next}`
  const document = canvasDocumentSchema.parse({
    version: 1,
    kind: 'canvas',
    artboards: [
      blankArtboard('wide-16x9', { x: 0, y: 0, newId, name: 'Hero' }),
      blankArtboard('square-1x1', { x: 1800, y: 0, newId, name: 'Square' }),
    ],
  })
  const writes: { baseRevision: number; document: CanvasDocument }[] = []
  const drafts: CanvasRecovery[] = []
  const remote = { revision: 1, document }
  const fake = { failure: null as unknown, wait: null as Promise<void> | null }
  const client = {
    canvas: {
      get: { query: async () => structuredClone(remote) },
      updateDocument: {
        mutate: async (input: { baseRevision: number; document: CanvasDocument }) => {
          writes.push(structuredClone(input))
          await fake.wait
          if (fake.failure) throw fake.failure
          if (input.baseRevision !== remote.revision)
            throw Object.assign(new Error('Revision conflict'), { data: { code: 'CONFLICT' } })
          remote.document = structuredClone(input.document)
          remote.revision = input.baseRevision + 1
          return { revision: remote.revision }
        },
      },
    },
  } as unknown as TRPCClient<AppRouter>
  const session = new CanvasSession(
    {
      id: 'c123456789012345678901234',
      name: 'Launch',
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
  const [hero, square] = document.artboards.map((artboard) => artboard.id) as [string, string]
  return { session, fake, writes, remote, drafts, document, hero, square }
}

test('a drag is one undo step and autosave writes it once, based on the saved revision', async () => {
  const { session, writes, hero } = fixture()
  try {
    session.command({ type: 'move-artboards', positions: [{ id: hero, x: 40, y: 300 }] })
    assert.equal(session.snapshot().status, 'unsaved')
    assert.equal(await session.save(), true)
    assert.deepEqual(
      writes.map((write) => write.baseRevision),
      [1]
    )
    assert.equal(session.snapshot().revision, 2)
    session.undo()
    assert.deepEqual(
      [session.snapshot().document.artboards[0]!.x, session.snapshot().document.artboards[0]!.y],
      [0, 0]
    )
    assert.equal(session.snapshot().canRedo, true)
    await session.save()
    assert.deepEqual(
      writes.map((write) => write.baseRevision),
      [1, 2]
    )
  } finally {
    session.dispose()
  }
})

test('saves are serialized: an edit made during a write is saved next, never lost', async () => {
  const { session, fake, writes, hero, square } = fixture()
  try {
    let release!: () => void
    fake.wait = new Promise<void>((resolve) => {
      release = resolve
    })
    session.command({ type: 'rename-artboard', id: hero, name: 'First' })
    const save = session.save()
    session.command({ type: 'rename-artboard', id: square, name: 'Second' })
    release()
    await save
    fake.wait = null
    await session.save()
    assert.deepEqual(
      writes.map((write) => write.baseRevision),
      [1, 2]
    )
    assert.deepEqual(
      writes.at(-1)!.document.artboards.map((artboard) => artboard.name),
      ['First', 'Second']
    )
    assert.equal(session.snapshot().status, 'saved')
  } finally {
    session.dispose()
  }
})

test('another editor’s independent change merges; an overlapping change stops as a conflict', async () => {
  const { session, remote, writes, document, hero, square } = fixture()
  try {
    remote.document = applyCanvasCommand(document, {
      type: 'rename-artboard',
      id: square,
      name: 'Theirs',
    })
    remote.revision = 2
    session.command({ type: 'move-artboards', positions: [{ id: hero, x: 500, y: 0 }] })
    assert.equal(await session.save(), true)
    const saved = writes.at(-1)!.document
    assert.equal(saved.artboards.find((artboard) => artboard.id === square)!.name, 'Theirs')
    assert.equal(saved.artboards.find((artboard) => artboard.id === hero)!.x, 500)
    remote.document = applyCanvasCommand(remote.document, {
      type: 'rename-artboard',
      id: hero,
      name: 'Their hero',
    })
    remote.revision += 1
    session.command({ type: 'rename-artboard', id: hero, name: 'My hero' })
    assert.equal(await session.save(), false)
    assert.equal(session.snapshot().status, 'conflict')
    assert.equal(
      session.snapshot().document.artboards[0]!.name,
      'My hero',
      'local work is preserved'
    )
  } finally {
    session.dispose()
  }
})

test('an interrupted save keeps a local recovery draft and retries later', async () => {
  const { session, fake, drafts, hero } = fixture()
  try {
    fake.failure = new TypeError('Failed to fetch')
    session.command({ type: 'rename-artboard', id: hero, name: 'Offline edit' })
    assert.equal(await session.save(), false)
    assert.equal(session.snapshot().status, 'offline')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const draft = drafts.at(-1)!
    assert.equal(draft.setId, session.record.id)
    assert.equal(draft.document.artboards[0]!.name, 'Offline edit')
    fake.failure = null
    assert.equal(await session.save(), true)
    assert.equal(session.snapshot().status, 'saved')
  } finally {
    session.dispose()
  }
})

test('a recovery draft based on an older revision opens as a conflict instead of overwriting', async () => {
  const { session, writes, document } = fixture()
  try {
    session.recover({
      key: 'tab',
      workspaceId: 'workspace',
      setId: session.record.id,
      tabId: 'other',
      revision: 7,
      updatedAt: Date.now(),
      document: applyCanvasCommand(document, {
        type: 'rename-artboard',
        id: document.artboards[0]!.id,
        name: 'Recovered',
      }),
    })
    assert.equal(session.snapshot().status, 'conflict')
    await session.save()
    assert.equal(writes.length, 0)
    assert.throws(() =>
      session.recover({
        key: 'x',
        workspaceId: 'other',
        setId: session.record.id,
        tabId: 't',
        revision: 1,
        updatedAt: 0,
        document,
      })
    )
  } finally {
    session.dispose()
  }
})

test('concurrent merges reorder or delete artboards only when both sides agree', () => {
  const { document, hero, square } = fixture()
  const local = applyCanvasCommand(document, { type: 'remove-artboards', ids: [square] })
  const remote = applyCanvasCommand(document, {
    type: 'move-artboards',
    positions: [{ id: hero, x: 9, y: 9 }],
  })
  const merged = mergeCanvasConcurrent(document, local, remote)
  assert.deepEqual(
    merged.artboards.map((artboard) => [artboard.id, artboard.x]),
    [[hero, 9]]
  )
  const edited = applyCanvasCommand(document, {
    type: 'rename-artboard',
    id: square,
    name: 'Edited',
  })
  assert.throws(
    () => mergeCanvasConcurrent(document, local, edited),
    ConcurrentEditError,
    'delete versus edit stops'
  )
})

test('a stage that has not mounted lays layers out at its reference width', () => {
  assert.deepEqual(
    pendingStageSize({
      canvasDimensions: null,
      selectedAspectRatio: 'custom',
      customDimensions: { width: 1600, height: 900 },
    }),
    {
      canvasW: 960,
      canvasH: 540,
    }
  )
  assert.deepEqual(
    pendingStageSize({
      canvasDimensions: { canvasW: 800, canvasH: 600, framedW: 700, framedH: 500 },
      selectedAspectRatio: 'custom',
      customDimensions: { width: 1080, height: 1920 },
    }),
    { canvasW: 800, canvasH: 800 / (1080 / 1920) }
  )
})

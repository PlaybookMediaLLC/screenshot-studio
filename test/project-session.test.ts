import assert from 'node:assert/strict'
import test from 'node:test'
import { type TRPCClient, TRPCClientError } from '@trpc/client'
import { exportDesignDocument } from '@/lib/design/export'
import { changedSections } from '@/lib/projects/compare'
import {
  closeProject,
  createProjectFromEditor,
  saveProjectNow,
  useProjectSession,
} from '@/lib/projects/session'
import { useImageStore } from '@/lib/store'
import type { AppRouter } from '@/lib/trpc/router'

type Write = { baseRevision: number; document: unknown; projectId: string }

/** A project router that records document writes and fails them on demand. */
function fakeClient() {
  const writes: Write[] = []
  const fake = {
    fail: null as Error | null,
    writes,
    client: {
      project: {
        create: {
          mutate: async (input: { name: string }) => ({
            id: 'cprojectsessiontest0000001',
            name: input.name,
            revision: 1,
            updatedAt: new Date(),
          }),
        },
        updateDocument: {
          mutate: async (input: Write) => {
            writes.push(input)
            if (fake.fail) throw fake.fail
            return { revision: input.baseRevision + 1, updatedAt: new Date() }
          },
        },
      },
    } as unknown as TRPCClient<AppRouter>,
  }
  return fake
}

const conflict = () =>
  TRPCClientError.from({
    error: {
      code: -32009,
      data: { code: 'CONFLICT', httpStatus: 409 },
      message: 'This project was saved elsewhere since you opened it.',
    },
  })

function editHeadline(text: string) {
  useImageStore.getState().clearTextOverlays()
  useImageStore.getState().addTextOverlay({
    color: '#ffffff',
    fontFamily: 'inter',
    fontSize: 48,
    fontWeight: 'bold',
    isVisible: true,
    opacity: 1,
    orientation: 'horizontal',
    position: { x: 50, y: 10 },
    text,
    textShadow: { blur: 0, color: 'rgba(0,0,0,0)', enabled: false, offsetX: 0, offsetY: 0 },
  })
}

test('autosave writes only real edits, each based on the last saved revision', async () => {
  useImageStore.setState({
    canvasDimensions: { canvasH: 900, canvasW: 1600, framedH: 800, framedW: 1400 },
  })
  const fake = fakeClient()
  await createProjectFromEditor(fake.client, 'Launch hero')
  assert.equal(useProjectSession.getState().status, 'saved')

  await saveProjectNow()
  assert.equal(fake.writes.length, 0, 'an unchanged design is not written')

  // Selecting is not an edit.
  useImageStore.getState().setSelectedTextId(null)
  assert.equal(useProjectSession.getState().status, 'saved')

  editHeadline('First')
  assert.equal(useProjectSession.getState().status, 'unsaved')
  await saveProjectNow()
  assert.equal(fake.writes.length, 1)
  assert.equal(fake.writes[0]?.baseRevision, 1)
  assert.deepEqual(useProjectSession.getState().status, 'saved')
  assert.equal(useProjectSession.getState().revision, 2)

  editHeadline('Second')
  await saveProjectNow()
  assert.equal(fake.writes[1]?.baseRevision, 2)
  closeProject()
})

test('a refused stale write stops autosave instead of retrying over newer work', async () => {
  const fake = fakeClient()
  await createProjectFromEditor(fake.client, 'Launch hero')
  fake.fail = conflict()
  editHeadline('Mine')
  await saveProjectNow()
  assert.equal(useProjectSession.getState().status, 'conflict')

  fake.fail = null
  editHeadline('Mine, again')
  await saveProjectNow()
  assert.equal(fake.writes.length, 1, 'no write is attempted while in conflict')
  assert.equal(useProjectSession.getState().status, 'conflict')
  closeProject()
})

test('an unreachable server keeps the changes and reports offline', async () => {
  const fake = fakeClient()
  await createProjectFromEditor(fake.client, 'Launch hero')
  fake.fail = new TypeError('fetch failed')
  editHeadline('Offline edit')
  await saveProjectNow()
  assert.equal(useProjectSession.getState().status, 'offline')

  fake.fail = null
  await saveProjectNow()
  assert.equal(useProjectSession.getState().status, 'saved')
  assert.equal(fake.writes.length, 2)
  closeProject()
  assert.equal(useProjectSession.getState().projectId, null)
})

test('a comparison names the sections that changed', () => {
  editHeadline('Before')
  const before = exportDesignDocument()
  editHeadline('After')
  useImageStore.getState().setBackgroundOpacity(0.5)
  const after = exportDesignDocument()
  assert.deepEqual(changedSections(before, after).sort(), ['background', 'texts'])
  assert.deepEqual(changedSections(after, after), [])
})

test('slide selection, playback, and layout measurement do not save a project', async () => {
  useImageStore.setState(useImageStore.getInitialState(), true)
  const slides = [
    { id: 'one', src: 'https://example.com/one.png', name: 'one.png', duration: 2 },
    { id: 'two', src: 'https://example.com/two.png', name: 'two.png', duration: 2 },
  ]
  useImageStore.setState({
    slides,
    activeSlideId: 'one',
    uploadedImageUrl: slides[0].src,
    imageName: slides[0].name,
  })
  const fake = fakeClient()
  await createProjectFromEditor(fake.client, 'Slides')
  const { usePlaybackStore } = await import('../lib/store/playback')
  usePlaybackStore.getState().play()
  usePlaybackStore.getState().seek(2500)
  useImageStore.getState().setActiveSlide('two')
  useImageStore
    .getState()
    .setCanvasDimensions({ canvasW: 1200, canvasH: 900, framedW: 1000, framedH: 800 })
  assert.equal(useProjectSession.getState().status, 'saved')
  await saveProjectNow()
  assert.equal(fake.writes.length, 0)
  editHeadline('A real edit while viewing slide two')
  await saveProjectNow()
  assert.equal(fake.writes.length, 1)
  usePlaybackStore.getState().pause()
  closeProject()
  useImageStore.setState(useImageStore.getInitialState(), true)
})

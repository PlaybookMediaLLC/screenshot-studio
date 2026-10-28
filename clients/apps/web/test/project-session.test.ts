import assert from 'node:assert/strict'
import test from 'node:test'
import { type TRPCClient, TRPCClientError } from '@trpc/client'
import { exportDesignDocument } from '@/lib/design/export'
import { changedSections } from '@/lib/projects/compare'
import { trackDraftRestore } from '@/lib/projects/draft-ready'
import {
  closeProject,
  createProjectFromEditor,
  releaseDraft,
  saveProjectNow,
  startNewDesign,
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
  assert.deepEqual(changedSections(before, after).sort(), ['background', 'layerOrder', 'texts'])
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

test('a new screenshot saves and closes the open project, then starts on a clean canvas', async () => {
  // The editor registers its local draft restore when it mounts; here it has finished.
  trackDraftRestore(Promise.resolve())
  const fake = fakeClient()
  await createProjectFromEditor(fake.client, 'Launch hero')
  editHeadline('Not saved yet')
  assert.equal(await startNewDesign(fake.client), 'started')
  assert.equal(fake.writes.length, 1, 'the pending edit reached the project first')
  assert.equal(useProjectSession.getState().projectId, null)
  assert.equal(useImageStore.getState().textOverlays.length, 0)
  editHeadline('New work')
  await saveProjectNow()
  assert.equal(fake.writes.length, 1, 'edits on the new canvas never reach the old project')
})

test('a new screenshot asks before replacing a design kept only on this device', async () => {
  const fake = fakeClient()
  editHeadline('Only on this device')
  assert.equal(await startNewDesign(fake.client), 'local-design')
  assert.equal(useImageStore.getState().textOverlays[0]?.text, 'Only on this device')
  assert.equal(await startNewDesign(fake.client, true), 'started')
  assert.equal(useImageStore.getState().textOverlays.length, 0)
  // An empty canvas has nothing to lose, so it starts without asking.
  assert.equal(await startNewDesign(fake.client), 'started')
})

test('a new screenshot does not start while the open project cannot save', async () => {
  const fake = fakeClient()
  await createProjectFromEditor(fake.client, 'Launch hero')
  fake.fail = new TypeError('fetch failed')
  editHeadline('Offline edit')
  assert.equal(await startNewDesign(fake.client), 'not-saved')
  assert.notEqual(useProjectSession.getState().projectId, null)
  assert.equal(useImageStore.getState().textOverlays[0]?.text, 'Offline edit')
  closeProject()
  useImageStore.setState(useImageStore.getInitialState(), true)
})

test("another tab's saved project never stands in for this tab's unsaved canvas", async () => {
  // Every tab of the browser shares one recovery record in localStorage.
  const shared = new Map<string, string>()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => shared.get(key) ?? null,
      removeItem: (key: string) => void shared.delete(key),
      setItem: (key: string, value: string) => void shared.set(key, value),
    },
  })
  try {
    trackDraftRestore(Promise.resolve())
    const fake = fakeClient()
    // This tab opened the editor without a project and made something.
    releaseDraft()
    editHeadline('Only in this tab')
    // Another tab then saved a project, leaving a clean record behind.
    shared.set(
      'shots.project-draft',
      JSON.stringify({ baseRevision: 1, dirty: false, projectId: 'cprojectsessiontest0000001' })
    )
    assert.equal(await startNewDesign(fake.client), 'local-design')
    assert.equal(useImageStore.getState().textOverlays[0]?.text, 'Only in this tab')
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete (globalThis as { localStorage?: unknown }).localStorage
    useImageStore.setState(useImageStore.getInitialState(), true)
  }
})

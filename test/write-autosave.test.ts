import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, before, test } from 'node:test'
import { act, createElement, StrictMode, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  DraftRequestError,
  draftsApi,
  type DraftSave,
  type DraftWire,
} from '@/lib/content-drafts/client'
import { useDraftDocument } from '@/components/write/composer/useDraftDocument'

const { JSDOM } = createRequire(import.meta.url)('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
const globals = Object.getOwnPropertyDescriptors(globalThis)
before(() => {
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  })
})
after(() => {
  dom.window.close()
  for (const name of ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT']) {
    if (globals[name]) Object.defineProperty(globalThis, name, globals[name])
    else Reflect.deleteProperty(globalThis, name)
  }
})

const draft = {
  id: 'draft',
  version: 1,
  title: 'Original',
  body: [],
  article: null,
  target: null,
  primaryPlatform: 'x',
  platformVersions: { schemaVersion: 1, versions: [] },
  channelConnectionIds: [],
  channelText: {},
  discussions: {},
} as unknown as DraftWire
const paragraph = (text: string) => [{ type: 'p', children: [{ text }] }]

async function mount() {
  let state!: ReturnType<typeof useDraftDocument>
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  function Harness() {
    const current = useDraftDocument({
      canEdit: true,
      collaborating: false,
      draft,
      onSaved: () => undefined,
    })
    useLayoutEffect(() => {
      state = current
    })
    return null
  }
  await act(async () => root.render(createElement(StrictMode, null, createElement(Harness))))
  return {
    get state() {
      return state
    },
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('unmount saves the current text even before the debounce runs', async (t) => {
  const save = t.mock.method(draftsApi, 'save', async (_id: string, input: DraftSave) => ({
    ...draft,
    ...input,
    version: 2,
  }))
  const editor = await mount()
  await act(async () => editor.state.update({ value: paragraph('Text before navigation') }))
  assert.equal(save.mock.callCount(), 0)
  assert.equal(editor.state.saveState, 'unsaved')
  await editor.unmount()
  assert.equal(save.mock.callCount(), 1)
  assert.equal(save.mock.calls[0].arguments[1].plainText, 'Text before navigation')
})

test('flush sees synchronous updates and serializes concurrent saves until the latest edit is persisted', async (t) => {
  const first = deferred<DraftWire>()
  const second = deferred<DraftWire>()
  const save = t.mock.method(draftsApi, 'save', (_id: string, input: DraftSave) =>
    input.baseVersion === 1 ? first.promise : second.promise
  )
  const editor = await mount()
  let flush!: Promise<void>
  await act(async () => {
    editor.state.update({ value: paragraph('First') })
    flush = editor.state.flush()
  })
  assert.equal(save.mock.callCount(), 1)
  assert.equal(save.mock.calls[0].arguments[1].plainText, 'First')
  let otherFlush!: Promise<void>
  let complete = false
  await act(async () => {
    editor.state.update({ value: paragraph('Latest'), title: 'Renamed' })
    otherFlush = editor.state.flush().then(() => {
      complete = true
    })
  })
  assert.equal(save.mock.callCount(), 1)
  await act(async () => first.resolve({ ...draft, version: 2 }))
  assert.equal(save.mock.callCount(), 2)
  assert.equal(save.mock.calls[1].arguments[1].baseVersion, 2)
  assert.equal(save.mock.calls[1].arguments[1].plainText, 'Latest')
  assert.equal(save.mock.calls[1].arguments[1].title, 'Renamed')
  assert.equal(complete, false)
  assert.notEqual(editor.state.saveState, 'saved')
  await act(async () => {
    second.resolve({ ...draft, version: 3 })
    await Promise.all([flush, otherFlush])
  })
  assert.equal(editor.state.saveState, 'saved')
  await editor.unmount()
  assert.equal(save.mock.callCount(), 2)
})

test('a failed flush blocks follow-up actions and retries the same document', async (t) => {
  const save = t.mock.method(
    draftsApi,
    'save',
    async (_id: string, _input: DraftSave): Promise<DraftWire> => {
      throw new DraftRequestError('Unavailable', 503)
    }
  )
  const editor = await mount()
  await act(async () => {
    editor.state.update({ value: paragraph('Keep this text') })
    await assert.rejects(editor.state.flush(), /could not be saved/)
  })
  assert.equal(editor.state.saveState, 'error')
  save.mock.mockImplementation(async () => ({ ...draft, version: 2 }))
  await act(async () => editor.state.flush())
  assert.equal(save.mock.calls[1].arguments[1].plainText, 'Keep this text')
  assert.equal(editor.state.saveState, 'saved')
  await editor.unmount()
})

test('a failed conflict reload keeps the unsaved document available for retry', async (t) => {
  const save = t.mock.method(
    draftsApi,
    'save',
    async (_id: string, _input: DraftSave): Promise<DraftWire> => {
      throw new DraftRequestError('Conflict', 409)
    }
  )
  t.mock.method(draftsApi, 'get', async () => {
    throw new Error('Offline')
  })
  const editor = await mount()
  await act(async () => {
    editor.state.update({ value: paragraph('Keep edits after conflict') })
    await assert.rejects(editor.state.flush(), /could not be saved/)
  })
  assert.equal(editor.state.saveState, 'error')
  save.mock.mockImplementation(async () => ({ ...draft, version: 2 }))
  await act(async () => editor.state.flush())
  assert.equal(save.mock.calls[1].arguments[1].plainText, 'Keep edits after conflict')
  await editor.unmount()
})

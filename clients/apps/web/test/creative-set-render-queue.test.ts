import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import type { DesignDocument } from '@/lib/design/document'
import { renderDocument } from '@/lib/render/scene-renderer'

test('render timeouts start when each job runs; queued cancellation is prompt and startup is bounded', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const originalWindow = globalThis.window,
    originalDocument = globalThis.document
  let receive: (event: unknown) => void = () => undefined
  const requests: { id: string }[] = []
  let frame: {
    contentWindow: { postMessage: (request: { id: string }) => void }
    remove: () => void
  }
  let mounted = 0
  const fakeWindow = {
    location: { origin: 'https://local.test' },
    addEventListener: (_name: string, listener: typeof receive) => {
      receive = listener
    },
  }
  const fakeDocument = {
    createElement: () => {
      frame = {
        contentWindow: { postMessage: (request) => requests.push(request) },
        remove: () => undefined,
      }
      return { ...frame, style: {}, setAttribute: () => undefined }
    },
    body: {
      appendChild: () => {
        mounted++
      },
    },
  }
  Object.assign(globalThis, { window: fakeWindow, document: fakeDocument })
  const emit = (data: unknown) =>
    receive({ source: frame.contentWindow, origin: fakeWindow.location.origin, data })
  const finish = (id: string) =>
    emit({ type: 'result', id, blob: new Blob(['png']), width: 1600, height: 900 })
  try {
    const first = renderDocument({} as DesignDocument, { format: 'png' })
    const second = renderDocument({} as DesignDocument, { format: 'png' })
    await setImmediate()
    assert.equal(mounted, 1)
    emit({ type: 'ready' })
    await setImmediate()
    assert.equal(requests.length, 1)
    context.mock.timers.tick(40_000)
    finish(requests[0]!.id)
    await first
    await setImmediate()
    assert.equal(requests.length, 2)
    context.mock.timers.tick(10_000)
    finish(requests[1]!.id)
    assert.equal((await second).width, 1600)
    const controller = new AbortController()
    const active = renderDocument(
      {} as DesignDocument,
      { format: 'png' },
      { signal: controller.signal }
    )
    const cancelled = assert.rejects(active, { name: 'AbortError' })
    await setImmediate()
    controller.abort()
    await cancelled
    await setImmediate()
    const neverReady = renderDocument({} as DesignDocument, { format: 'png' })
    const timeout = assert.rejects(neverReady, /frame did not start/)
    await setImmediate()
    context.mock.timers.tick(45_000)
    await timeout
    assert.equal(mounted, 2)
  } finally {
    Object.assign(globalThis, { window: originalWindow, document: originalDocument })
    context.mock.timers.reset()
  }
})

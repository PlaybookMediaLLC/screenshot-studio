import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { observeNotificationSummary } from '@/lib/notifications/visibility'

function viewport(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    hasFocus: () => focused,
    defaultView: new EventTarget(),
  })
  let focused = true
  let notify: IntersectionObserverCallback = () => undefined
  let disconnected = false
  class Observer {
    constructor(callback: IntersectionObserverCallback) {
      notify = callback
    }
    observe() {}
    disconnect() {
      disconnected = true
    }
  }
  Object.assign(doc.defaultView, { IntersectionObserver: Observer })
  const original = globalThis.IntersectionObserver
  Object.assign(globalThis, { IntersectionObserver: Observer })
  t.after(() => {
    Object.assign(globalThis, { IntersectionObserver: original })
  })
  return {
    element: { ownerDocument: doc } as unknown as HTMLElement,
    enter(visible: boolean, ratio = 1) {
      notify(
        [{ isIntersecting: visible, intersectionRatio: ratio }] as IntersectionObserverEntry[],
        {} as IntersectionObserver
      )
    },
    focus(value: boolean) {
      focused = value
      doc.defaultView.dispatchEvent(new Event(value ? 'focus' : 'blur'))
    },
    hidden(value: boolean) {
      doc.visibilityState = value ? 'hidden' : 'visible'
      doc.dispatchEvent(new Event('visibilitychange'))
    },
    disconnected: () => disconnected,
  }
}
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('only a continuously visible summary in an active tab is acknowledged', async (t) => {
  const view = viewport(t)
  let seen = 0
  const dispose = observeNotificationSummary(view.element, null, async () => {
    seen++
  })
  t.mock.timers.tick(2000)
  assert.equal(seen, 0, 'prefetch or opening does not acknowledge')
  view.enter(true, 0.5)
  t.mock.timers.tick(1000)
  assert.equal(seen, 0, 'offscreen summaries remain unseen')
  view.enter(true)
  t.mock.timers.tick(300)
  view.hidden(true)
  t.mock.timers.tick(2000)
  assert.equal(seen, 0)
  view.hidden(false)
  t.mock.timers.tick(300)
  view.focus(false)
  t.mock.timers.tick(2000)
  assert.equal(seen, 0)
  view.focus(true)
  t.mock.timers.tick(499)
  assert.equal(seen, 0)
  t.mock.timers.tick(1)
  await flush()
  assert.equal(seen, 1)
  view.enter(true)
  t.mock.timers.tick(3000)
  assert.equal(seen, 1)
  dispose()
  assert.equal(view.disconnected(), true)
})

test('failed acknowledgments retry only while visible and closing cancels work', async (t) => {
  const view = viewport(t)
  let attempts = 0
  const dispose = observeNotificationSummary(view.element, null, async () => {
    if (++attempts === 1) throw new Error('offline')
  })
  view.enter(true)
  t.mock.timers.tick(500)
  await flush()
  assert.equal(attempts, 1)
  view.enter(false)
  t.mock.timers.tick(5000)
  assert.equal(attempts, 1)
  view.enter(true)
  t.mock.timers.tick(500)
  await flush()
  assert.equal(attempts, 2)
  dispose()
  t.mock.timers.tick(5000)
  assert.equal(attempts, 2)
  const closeBeforeVisible = observeNotificationSummary(view.element, null, async () => {
    attempts++
  })
  view.enter(true)
  closeBeforeVisible()
  t.mock.timers.tick(500)
  assert.equal(attempts, 2)
})

test('an acknowledgment failure retries while its summary stays visible', async (t) => {
  const view = viewport(t)
  let attempts = 0
  const dispose = observeNotificationSummary(view.element, null, async () => {
    if (++attempts === 1) throw new Error('offline')
  })
  view.enter(true)
  t.mock.timers.tick(500)
  await flush()
  assert.equal(attempts, 1)
  t.mock.timers.tick(2000)
  await flush()
  assert.equal(attempts, 2)
  dispose()
})

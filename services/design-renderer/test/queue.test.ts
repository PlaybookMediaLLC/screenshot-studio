import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RenderQueue, QueueFullError, QueueTimeoutError, DrainingError } from '../src/queue.js'

const signal = () => new AbortController().signal
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

test('reserves FIFO slots and never exceeds concurrency under a burst', async () => {
  const queue = new RenderQueue(2, 100, 10000)
  let peak = 0
  const order: number[] = []
  await Promise.all(
    Array.from({ length: 100 }, (_, id) =>
      queue.run(signal(), async () => {
        peak = Math.max(peak, queue.active)
        order.push(id)
        await tick()
      })
    )
  )
  assert.equal(peak, 2)
  assert.deepEqual(
    order,
    Array.from({ length: 100 }, (_, id) => id)
  )
  assert.equal(queue.active, 0)
  assert.equal(queue.queued, 0)
})

test('expired waiters release queue capacity without starting work', async () => {
  const queue = new RenderQueue(1, 1, 30)
  const held = gate()
  const active = queue.run(signal(), () => held.promise)
  let started = false
  const expired = queue.run(signal(), async () => {
    started = true
  })
  await assert.rejects(
    queue.run(signal(), async () => {}),
    QueueFullError
  )
  await assert.rejects(expired, QueueTimeoutError)
  assert.equal(queue.queued, 0)
  const next = queue.run(signal(), async () => 'next')
  held.release()
  await active
  assert.equal(await next, 'next')
  assert.equal(started, false)
})

test('cancelled waiters are removed and draining preserves active work', async () => {
  const queue = new RenderQueue(1, 2, 10000)
  const held = gate()
  const active = queue.run(signal(), () => held.promise)
  const client = new AbortController()
  const cancelled = queue.run(client.signal, async () => assert.fail('cancelled work ran'))
  client.abort(new Error('gone'))
  await assert.rejects(cancelled, /gone/)
  assert.equal(queue.queued, 0)
  const waiting = queue.run(signal(), async () => assert.fail('drained work ran'))
  queue.drain()
  await assert.rejects(waiting, DrainingError)
  await assert.rejects(
    queue.run(signal(), async () => {}),
    DrainingError
  )
  assert.equal(queue.active, 1)
  held.release()
  await active
  assert.equal(queue.active, 0)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { browserTRPCFetch } from '@/lib/trpc/browser-fetch'

test('gateway failures retry reads with no-store and recover from HTML', async (t) => {
  const calls: RequestInit[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls.push(init)
    return calls.length < 3
      ? new Response('<!DOCTYPE html>Unavailable', {
          status: 503,
          headers: { 'content-type': 'text/html' },
        })
      : Response.json({ result: 'recovered' })
  })
  assert.deepEqual(await (await browserTRPCFetch('/api/trpc/project.list')).json(), {
    result: 'recovered',
  })
  assert.equal(calls.length, 3)
  assert.ok(calls.every((call) => call.cache === 'no-store'))
})

test('failed mutations are never replayed and HTML never reaches the JSON parser', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('<html>Error</html>', {
        status: 504,
        headers: { 'content-type': 'text/html' },
      })
  )
  await assert.rejects(
    browserTRPCFetch('/api/trpc/project.create', { method: 'POST' }),
    /temporarily unavailable/
  )
  assert.equal(fetch.mock.callCount(), 1)
})

test('JSON authorization errors are left for tRPC and are not retried', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: 'Forbidden' }, { status: 403 })
  )
  const response = await browserTRPCFetch('/api/trpc/project.list')
  assert.equal(response.status, 403)
  assert.equal(fetch.mock.callCount(), 1)
})

test('mislabelled HTML also produces a friendly error', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('<!DOCTYPE html>Error', {
        headers: { 'content-type': 'application/json' },
      })
  )
  await assert.rejects(browserTRPCFetch('/api/trpc/project.list'), /temporarily unavailable/)
})

test('aborting a retry stops the request', async (t) => {
  const controller = new AbortController()
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    controller.abort()
    return new Response('', { status: 502 })
  })
  await assert.rejects(browserTRPCFetch('/api/trpc/project.list', { signal: controller.signal }), {
    name: 'AbortError',
  })
  assert.equal(fetch.mock.callCount(), 1)
})

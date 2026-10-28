import assert from 'node:assert/strict'
import test from 'node:test'
import {
  readBoundedBody,
  readBoundedText,
  RequestBodyTooLargeError,
  withBoundedBody,
} from '@/lib/security/request-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'
import { route } from '@/lib/api/route'

function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift()
      if (chunk) controller.enqueue(chunk)
      else controller.close()
    },
    cancel() {
      cancelled = true
    },
  })
  const request = new Request('https://studio.test/api/test', {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  } as RequestInit)
  return { request, cancelled: () => cancelled }
}

test('body limit counts streamed bytes with missing or dishonest Content-Length', async () => {
  const lengthHeaders: Record<string, string>[] = [{}, { 'content-length': '1' }]
  for (const headers of lengthHeaders) {
    const f = streamed([new Uint8Array(5), new Uint8Array(5), new Uint8Array(5)], headers)
    await assert.rejects(readBoundedBody(f.request, 8), RequestBodyTooLargeError)
    assert.equal(f.cancelled(), true)
  }
  const f = streamed([new Uint8Array(1)], { 'content-length': '1000' })
  await assert.rejects(readBoundedBody(f.request, 8), RequestBodyTooLargeError)
  assert.equal(f.cancelled(), true)
})

test('bounded reading preserves signed webhook text and accepts the exact byte limit', async () => {
  const text = '{ "release": "🚀", "lines": "one\\ntwo" }\n'
  const bytes = new TextEncoder().encode(text)
  const f = streamed([bytes.subarray(0, 18), bytes.subarray(18)])
  assert.equal(await readBoundedText(f.request, bytes.length), text)
})

test('vendor handlers receive the original method, headers, and body after bounding', async () => {
  const original = new Request('https://studio.test/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'session=test' },
    body: '{ "value": "unchanged" }',
  })
  const bounded = await withBoundedBody(original)
  assert.equal(bounded.method, 'POST')
  assert.equal(bounded.headers.get('content-type'), 'application/json')
  assert.equal(bounded.headers.get('cookie'), 'session=test')
  assert.equal(await bounded.text(), '{ "value": "unchanged" }')
})

test('bounded vendor requests support the framework Request proxy', async () => {
  const request = new Request('https://studio.test/api/auth/sign-in/email', {
    method: 'POST',
    headers: { cookie: 'session=test' },
    body: 'original',
    redirect: 'manual',
  })
  const proxy = new Proxy(request, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const bounded = await withBoundedBody(proxy)
  assert.equal(bounded.url, request.url)
  assert.equal(bounded.headers.get('cookie'), 'session=test')
  assert.equal(bounded.redirect, 'manual')
  assert.equal(await bounded.text(), 'original')
})

test('oversized route bodies return 413 without reaching the mutation handler', async (t) => {
  t.mock.method(console, 'info', () => undefined)
  const contract = defineContract({
    name: 'test.bounded',
    path: '/api/test',
    method: 'POST',
    summary: 'Bounded mutation',
    maxBodyBytes: 8,
    body: z.object({ text: z.string() }),
    output: z.object({ ok: z.boolean() }),
  })
  const handler = t.mock.fn(async () => ({ ok: true }))
  const request = new NextRequest('https://studio.test/api/test', {
    method: 'POST',
    body: JSON.stringify({ text: 'too big' }),
  })
  const response = await route(contract, { auth: async () => null, handler })(request, {
    params: Promise.resolve({}),
  })
  assert.equal(response.status, 413)
  assert.equal((await response.json()).code, 'invalid_request')
  assert.equal(handler.mock.callCount(), 0)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})

test('signature text preserves a UTF-8 BOM and refuses lossy decoding', async () => {
  const text = '\uFEFF{"release":"café 🚀"}'
  const bytes = new TextEncoder().encode(text)
  assert.equal(await readBoundedText(streamed([bytes]).request), text)
  await assert.rejects(
    readBoundedText(streamed([new Uint8Array([0xff, 0xfe])]).request),
    SyntaxError
  )
})

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { safeFetchText } from '@/lib/launch/safe-fetch'

test('stalled DNS cannot hold a fetch open beyond its deadline', async () => {
  const result = await safeFetchText('https://public.example/', {
    timeoutMs: 20,
    resolve: () => new Promise(() => {}),
    transport: async () => {
      throw new Error('Must not connect without DNS')
    },
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /too long to resolve/)
})

test('a continuously trickling response cannot bypass the wall-clock deadline', async (t) => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.write('first')
    const timer = setInterval(() => response.write('more'), 10)
    response.on('close', () => clearInterval(timer))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const result = await safeFetchText(`http://127.0.0.1:${address.port}/`, {
    allowedPrivateHosts: new Set(['127.0.0.1']),
    timeoutMs: 100,
  })
  assert.equal(result.ok, false)
})

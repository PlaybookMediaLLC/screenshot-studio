import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchProxyImage, isAllowedProxyImage } from '@/lib/image-proxy'
import type { Transport } from '@/lib/launch/safe-fetch'

test('image proxy only accepts credential-free HTTPS on exact allowed hosts and ports', () => {
  assert.equal(isAllowedProxyImage(new URL('https://pbs.twimg.com/media/a.png')), true)
  for (const url of [
    'http://pbs.twimg.com/a',
    'https://pbs.twimg.com:8443/a',
    'https://user:secret@pbs.twimg.com/a',
    'https://pbs.twimg.com.attacker.example/a',
    'https://attacker.example/a',
    'file://pbs.twimg.com/a',
  ])
    assert.equal(isAllowedProxyImage(new URL(url)), false, url)
})

function fixture(status: number, headers: Record<string, string>, chunks = [Buffer.from('image')]) {
  const calls: string[] = []
  let destroyed = false
  const transport: Transport = async ({ url }) => {
    calls.push(url.toString())
    return {
      status,
      headers,
      destroy: () => {
        destroyed = true
      },
      body: (async function* () {
        yield* chunks
      })(),
    }
  }
  const resolve = async () => [{ address: '1.1.1.1', family: 4 }]
  return { calls, options: { resolve, transport }, destroyed: () => destroyed }
}

test('image proxy refuses redirects leaving its HTTPS origin allowlist before connecting', async () => {
  for (const location of [
    'http://127.0.0.1/private',
    'https://attacker.example/a',
    'http://pbs.twimg.com/a',
  ]) {
    const f = fixture(302, { location })
    const result = await fetchProxyImage(new URL('https://pbs.twimg.com/a'), f.options)
    assert.equal(result.ok, false)
    assert.equal(f.calls.length, 1)
    assert.equal(f.destroyed(), true)
  }
})

test('image proxy refuses private DNS, HTML, SVG, and oversized bodies', async () => {
  const f = fixture(200, { 'content-type': 'image/png' })
  assert.equal(
    (
      await fetchProxyImage(new URL('https://pbs.twimg.com/a'), {
        ...f.options,
        resolve: async () => [{ address: '::ffff:7f00:1', family: 6 }],
      })
    ).ok,
    false
  )
  assert.equal(f.calls.length, 0)
  for (const contentType of ['text/html', 'image/svg+xml', 'application/javascript', '']) {
    const f = fixture(200, { 'content-type': contentType })
    assert.equal((await fetchProxyImage(new URL('https://pbs.twimg.com/a'), f.options)).ok, false)
  }
  const large = fixture(200, { 'content-type': 'image/png' }, [
    Buffer.alloc(10 * 1024 * 1024),
    Buffer.from('x'),
  ])
  assert.equal((await fetchProxyImage(new URL('https://pbs.twimg.com/a'), large.options)).ok, false)
  assert.equal(large.destroyed(), true)
})

test('supported images retain their bytes and media type', async () => {
  const f = fixture(200, { 'content-type': 'image/png' })
  const result = await fetchProxyImage(new URL('https://pbs.twimg.com/a'), f.options)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.contentType, 'image/png')
    assert.equal(result.bytes.toString(), 'image')
  }
})

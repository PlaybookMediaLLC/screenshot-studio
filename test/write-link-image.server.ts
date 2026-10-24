import assert from 'node:assert/strict'
import test, { before } from 'node:test'
import sharp from 'sharp'
import { readLinkImage } from '../lib/content-drafts/link-image'
import { isPublicAddress, type Transport } from '../lib/launch/safe-fetch'

const resolve = async () => [{ address: '93.184.216.34', family: 4 }]
let png: Buffer
before(async () => {
  png = await sharp({ create: { width: 40, height: 20, channels: 4, background: '#ff000080' } })
    .png()
    .toBuffer()
})
function fixture(
  imageUrl: string,
  imageBytes = png,
  contentType = 'image/png',
  redirect?: string
): Transport {
  return async ({ url }) => {
    const page = url.pathname === '/page'
    return {
      body: (async function* () {
        yield page ? Buffer.from(`<meta property="og:image" content="${imageUrl}">`) : imageBytes
      })(),
      destroy: () => {},
      status: !page && redirect ? 302 : 200,
      headers:
        !page && redirect
          ? { location: redirect }
          : { 'content-type': page ? 'text/html' : contentType },
    }
  }
}
test('TF-040: ingest decodes a public metadata image into durable static-image bytes', async () => {
  const result = await readLinkImage('https://public.example/page', {
    resolve,
    transport: fixture('/image.png'),
  })
  assert.equal(result.width, 40)
  assert.equal(result.height, 20)
  assert.equal((await sharp(result.body).metadata()).format, 'png')
})
test('TF-040 security: reject private sources, redirects, disguised images and unsupported formats', async () => {
  for (const address of [
    '127.0.0.1',
    '0:0:0:0:0:ffff:7f00:1',
    '::ffff:169.254.169.254',
    '2002:7f00:1::',
    '2001:0000:4136:e378:8000:63bf:3fff:fdd2',
  ])
    assert.equal(isPublicAddress(address), false)
  for (const transport of [
    fixture('http://127.0.0.1/secret'),
    fixture('/image.png', png, 'image/png', 'http://169.254.169.254/latest/meta-data'),
    fixture('/image.png', Buffer.from('<svg onload="alert(1)"/>')),
    fixture('/image.svg', png, 'image/svg+xml'),
  ]) {
    await assert.rejects(readLinkImage('https://public.example/page', { resolve, transport }))
  }
})

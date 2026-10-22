import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { createAssetThumbnail } from '@/lib/workspace/asset-thumbnail'

for (const [width, height] of [
  [1200, 900],
  [2160, 3840],
  [2160, 2160],
  [160, 90],
]) {
  test(`thumbnail fits the full ${width}x${height} composition without enlarging`, async () => {
    const original = await sharp({ create: { width, height, channels: 4, background: '#34aabb' } })
      .png()
      .toBuffer()
    const thumbnail = await createAssetThumbnail(original)
    const metadata = await sharp(thumbnail).metadata()
    const scale = Math.min(1, 640 / width, 640 / height)
    assert.equal(metadata.width, Math.round(width * scale))
    assert.equal(metadata.height, Math.round(height * scale))
    assert.equal(metadata.format, 'webp')
    assert.ok(thumbnail.length < original.length)
  })
}

test('invalid files and active formats cannot become previews', async () => {
  await assert.rejects(createAssetThumbnail(Buffer.from('not an image')))
  await assert.rejects(
    createAssetThumbnail(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>')
    )
  )
})

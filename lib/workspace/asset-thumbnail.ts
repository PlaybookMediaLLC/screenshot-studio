import sharp from 'sharp'

/** A bounded gallery preview; originals remain available through Download. */
export async function createAssetThumbnail(body: Uint8Array): Promise<Buffer> {
  if (body.byteLength > 50 * 1024 * 1024) throw new Error('Image exceeds the asset limit.')
  const image = sharp(body, { limitInputPixels: 64_000_000 })
  const metadata = await image.metadata()
  if (!metadata.format || !['png', 'jpeg', 'webp', 'gif'].includes(metadata.format)) {
    throw new Error('This asset does not support image previews.')
  }
  return image
    .rotate()
    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer()
}

import 'server-only'
import sharp from 'sharp'
import { allowedTestHosts, safeFetchBytes, type SafeFetchOptions } from '@/lib/launch/safe-fetch'
import { readLinkCard } from '@/lib/content-drafts/link-card'
import { MEDIA_LIMITS } from '@/lib/write/media-limits'

/** Rediscover and decode a page's image; every redirect is pinned to public addresses. */
export async function readLinkImage(url: string, options: SafeFetchOptions = {}) {
  const card = await readLinkCard(url, options)
  if (!card?.image) throw new Error('This page does not offer an image to attach.')
  const image = await safeFetchBytes(card.image, {
    allowedPrivateHosts: allowedTestHosts(),
    ...options,
    maxBytes: MEDIA_LIMITS.paidImageBytes,
  })
  if (!image.ok || image.truncated)
    throw new Error('The image is unavailable or larger than 20 MB.')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.contentType))
    throw new Error('Choose a page with a static JPEG, PNG or WebP image.')
  const decoded = sharp(image.bytes, {
    limitInputPixels: MEDIA_LIMITS.imagePixels,
    failOn: 'warning',
  })
  const metadata = await decoded.metadata()
  if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
    throw new Error('The image is not a supported static image.')
  const { data, info } = await decoded
    .rotate()
    .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true })
  if (data.length > MEDIA_LIMITS.paidImageBytes)
    throw new Error('The decoded image is too large to attach.')
  return { body: data, width: info.width, height: info.height, sourceUrl: card.url }
}

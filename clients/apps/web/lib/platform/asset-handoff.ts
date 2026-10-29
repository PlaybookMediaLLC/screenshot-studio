import { contentDraftIdSchema } from '@/lib/api/contracts/content-drafts'

const IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const VIDEOS = new Set(['video/mp4', 'video/quicktime', 'video/webm'])

/** The writing editor's existing native media formats. */
export function supportedDraftMedia(mediaType: string): boolean {
  return IMAGES.has(mediaType) || VIDEOS.has(mediaType)
}

/** Keep the asset reference, not an expiring signed URL or a downloaded copy. */
export function draftAssetNode(asset: { id: string; mediaType: string }) {
  const id = contentDraftIdSchema.parse(asset.id)
  if (!supportedDraftMedia(asset.mediaType))
    throw new Error('Export this asset to a supported image or video format first.')
  return {
    type: IMAGES.has(asset.mediaType) ? 'img' : 'video',
    assetId: id,
    // The stored type lets the composer check each destination's formats.
    mimeType: asset.mediaType,
    url: `/api/v1/assets/${encodeURIComponent(id)}/content`,
    children: [{ text: '' }],
  }
}

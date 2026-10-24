import { createHash } from 'node:crypto'
import {
  draftGiphyAttachContract,
  draftGiphySearchContract,
} from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { giphyEnabled, searchGiphy, selectedGiphy } from '@/lib/content-drafts/giphy'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { linkPreviewLimit } from '@/lib/link-preview/limit'

/** Search only when server access and durable storage have provider approval. */
export const GET = route(draftGiphySearchContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, query }) => {
    if (!contentDraftsEnabled() || !giphyEnabled())
      return errorResponse(
        503,
        'GIPHY search is not enabled. Provider approval for server search and durable storage is required.'
      )
    const limited = await linkPreviewLimit(access.organizationId)
    if (limited) return limited
    try {
      return { items: await searchGiphy(query.q) }
    } catch (error) {
      return errorResponse(
        503,
        error instanceof Error && error.message.startsWith('GIPHY')
          ? error.message
          : 'GIPHY search failed. Try again later.'
      )
    }
  },
})

/** Explicitly persist through the same signed-upload and Go completion checks as file uploads. */
export const POST = route(draftGiphyAttachContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body }) => {
    if (!contentDraftsEnabled() || !giphyEnabled())
      return errorResponse(503, 'GIPHY attachment requires provider approval for durable storage.')
    const limited = await linkPreviewLimit(access.organizationId)
    if (limited) return limited
    const selected = await selectedGiphy(body.id).catch(() => null)
    if (!selected)
      return errorResponse(
        422,
        'The selected GIF is unavailable or exceeds 15 MB. Choose another result.'
      )
    const sdk = backendSDK(access)
    const sha256 = createHash('sha256').update(selected.body).digest('hex')
    const { asset, uploadUrl } = await sdk.signAssetUpload({
      bytes: selected.body.length,
      contentType: 'image/gif',
      fileName: `giphy-${body.id}.gif`,
      classification: 'input',
      sha256,
    })
    const uploaded = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/gif', 'if-none-match': '*' },
      body: new Uint8Array(selected.body),
      signal: AbortSignal.timeout(60_000),
    })
    if (!uploaded.ok) return errorResponse(503, 'The GIF could not be saved. Try again.')
    await sdk.completeAssetUpload(asset.id, sha256)
    return { assetId: asset.id, sourceUrl: selected.sourceUrl }
  },
})

import { playContract } from '@/lib/api/contracts/store-publishing'
import { errorResponse, route } from '@/lib/api/route'
import { paidSessionAccess } from '@/lib/api/route-auth'
import {
  decodeBase64Image,
  storeScreenshotsErrorResponse,
} from '@/lib/api/store-screenshots-errors'
import { commitPlayEdit, startPlayEdit, uploadToPlay } from '@/lib/tenant/store-screenshots'

/** Image uploads to Google Play can take a while. */
export const maxDuration = 120

/**
 * Google Play listing images: start an edit, upload into it, then commit it
 * as a separate, explicitly confirmed step. Uploads alone change nothing on
 * the live listing.
 */
export const POST = route(playContract, {
  auth: paidSessionAccess('publish:manage'),
  handler: async ({ access, body }) => {
    try {
      if (body.action === 'start')
        return { editId: (await startPlayEdit(access, body.credentialId, body.packageName)).id }
      if (body.action === 'commit') {
        await commitPlayEdit(access, body.credentialId, body.packageName, body.editId)
        return { committed: true }
      }
      const bytes = decodeBase64Image(body.image)
      if (!bytes) return errorResponse(400, 'The screenshot data is not valid.')
      const mime = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg'
      const image = await uploadToPlay(access, {
        credentialId: body.credentialId,
        packageName: body.packageName,
        editId: body.editId,
        language: body.language,
        imageType: body.imageType,
        clearFirst: body.clearFirst,
        bytes,
        mime,
      })
      return { imageId: image.id }
    } catch (cause) {
      return storeScreenshotsErrorResponse(cause)
    }
  },
})

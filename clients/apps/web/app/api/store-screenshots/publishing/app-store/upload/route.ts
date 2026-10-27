import { ascDisplayTypeSchema } from '@/lib/integrations/app-store-connect'
import { ascUploadContract } from '@/lib/api/contracts/store-publishing'
import { errorResponse, route } from '@/lib/api/route'
import { paidSessionAccess } from '@/lib/api/route-auth'
import {
  decodeBase64Image,
  storeScreenshotsErrorResponse,
} from '@/lib/api/store-screenshots-errors'
import { uploadToAppStore } from '@/lib/tenant/store-screenshots'

/** Uploads to App Store Connect can take a while for large files. */
export const maxDuration = 120

/** Upload one screenshot into a version localization. This never submits the app for review. */
export const POST = route(ascUploadContract, {
  auth: paidSessionAccess('publish:manage'),
  handler: async ({ access, body }) => {
    const displayType = ascDisplayTypeSchema.safeParse(body.displayType)
    if (!displayType.success) return errorResponse(400, 'That display type cannot be uploaded.')
    const bytes = decodeBase64Image(body.image)
    if (!bytes) return errorResponse(400, 'The screenshot data is not valid.')
    try {
      return await uploadToAppStore(access, {
        credentialId: body.credentialId,
        localizationId: body.localizationId,
        displayType: displayType.data,
        fileName: body.fileName,
        bytes,
        clearFirst: body.clearFirst,
      })
    } catch (cause) {
      return storeScreenshotsErrorResponse(cause)
    }
  },
})

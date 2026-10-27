import { figmaFramesContract } from '@/lib/api/contracts/store-screenshots'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { FigmaError, listFigmaFrames } from '@/lib/integrations/figma'

/** List the frames of a Figma file. The token is used once and not stored or logged. */
export const POST = route(figmaFramesContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ body }) => {
    try {
      return { frames: await listFigmaFrames(body.fileKey, body.token) }
    } catch (cause) {
      if (cause instanceof FigmaError) return errorResponse(cause.status, cause.message)
      throw cause
    }
  },
})

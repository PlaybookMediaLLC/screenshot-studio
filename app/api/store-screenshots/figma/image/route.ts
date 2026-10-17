import { figmaImageContract } from '@/lib/api/contracts/store-screenshots'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { FigmaError, renderFigmaFrame } from '@/lib/integrations/figma'

/** Rendering a large frame at 2x can take a while. */
export const maxDuration = 60

/** Render one Figma frame as PNG bytes. */
export const POST = route(figmaImageContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ body }) => {
    try {
      const bytes = await renderFigmaFrame(body.fileKey, body.nodeId, body.token, body.scale)
      return new Response(bytes as BodyInit, {
        headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
      })
    } catch (cause) {
      if (cause instanceof FigmaError) return errorResponse(cause.status, cause.message)
      throw cause
    }
  },
})

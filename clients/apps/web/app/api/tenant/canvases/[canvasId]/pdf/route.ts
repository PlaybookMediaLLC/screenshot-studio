import { canvasPdfContract } from '@/lib/api/contracts/canvases'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { CanvasPdfUnavailableError, printCanvasPdf } from '@/lib/canvas/print'
import { DesignRenderLimitError } from '@/lib/design/render-design'
import { CanvasPrintRefusedError } from '@/lib/design/renderer'

/** Printing many large artboards can take a while. */
export const maxDuration = 300

/** Print a canvas's artboards to a PDF whose pages keep real text and vector shapes. */
export const POST = route(canvasPdfContract, {
  auth: tenantAccess(canvasPdfContract.access),
  handler: async ({ access, body, params }) => {
    try {
      const pdf = await printCanvasPdf(access, params.canvasId, body.artboardIds)
      if (!pdf) return errorResponse(404, 'Canvas not found.')
      return new Response(new Uint8Array(pdf), {
        headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' },
      })
    } catch (cause) {
      if (cause instanceof CanvasPdfUnavailableError) return errorResponse(503, cause.message)
      if (cause instanceof DesignRenderLimitError) return errorResponse(429, cause.message)
      if (cause instanceof CanvasPrintRefusedError) return errorResponse(422, cause.message)
      throw cause
    }
  },
})

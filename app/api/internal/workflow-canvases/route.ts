import { z } from 'zod'
import { workflowCanvasContract } from '@/lib/api/contracts/internal'
import { apiError } from '@/lib/api/errors'
import { type Authenticate, route } from '@/lib/api/route'
import { AuthorizationError } from '@/lib/auth/access'
import {
  createWorkflowCanvas,
  WorkflowCanvasRefusedError,
  workflowCanvasRequestSchema,
} from '@/lib/workflows/canvas'
import { verifyWorkflowRenderSignature } from '@/lib/workflows/render-signature'

/** The Go worker signs the exact body with the shared workflow render key. */
const workerSignatureAccess: Authenticate<null> = async ({ raw, request }) => {
  const { body } = await raw()
  if (
    !verifyWorkflowRenderSignature(
      z.string().parse(body),
      request.headers.get('x-shots-signature'),
      process.env.PLATFORM_WORKFLOW_RENDER_KEY ?? ''
    )
  ) {
    throw new AuthorizationError('Unauthorized workflow canvas.', 401)
  }
  return null
}

/**
 * Lay out a workflow run's canvas from its release. The tenant comes from
 * the signed request the worker built from its persisted run; a retry
 * returns the canvas the node already made.
 */
export const POST = route(workflowCanvasContract, {
  auth: workerSignatureAccess,
  handler: async ({ body }) => {
    const request = workflowCanvasRequestSchema.safeParse(JSON.parse(body))
    if (!request.success) {
      return apiError(
        422,
        'invalid_request',
        z.prettifyError(request.error),
        'Fix the worker request.'
      )
    }
    try {
      return await createWorkflowCanvas(request.data)
    } catch (error) {
      if (error instanceof WorkflowCanvasRefusedError) {
        return apiError(422, 'invalid_request', error.message, 'Point the workflow at a release.')
      }
      throw error
    }
  },
})

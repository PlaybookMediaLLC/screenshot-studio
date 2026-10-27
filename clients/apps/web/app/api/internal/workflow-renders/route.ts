import { z } from 'zod'
import { workflowRenderContract } from '@/lib/api/contracts/internal'
import { apiError } from '@/lib/api/errors'
import { type Authenticate, route } from '@/lib/api/route'
import { AuthorizationError } from '@/lib/auth/access'
import {
  renderWorkflowCreatives,
  WorkflowRenderUnavailableError,
  workflowRenderRequestSchema,
} from '@/lib/workflows/render'
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
    throw new AuthorizationError('Unauthorized workflow render.', 401)
  }
  return null
}

/**
 * Render a workflow run's creatives into its campaign. The tenant comes from
 * the signed request the worker built from its persisted run; a retry reuses
 * the node's designs and renders.
 */
export const POST = route(workflowRenderContract, {
  auth: workerSignatureAccess,
  handler: async ({ body }) => {
    const request = workflowRenderRequestSchema.safeParse(JSON.parse(body))
    if (!request.success) {
      return apiError(
        422,
        'invalid_request',
        z.prettifyError(request.error),
        'Fix the worker request.'
      )
    }
    try {
      return await renderWorkflowCreatives(request.data)
    } catch (error) {
      if (error instanceof WorkflowRenderUnavailableError) {
        return apiError(
          503,
          'upstream_unavailable',
          error.message,
          'Retry after the renderer recovers.'
        )
      }
      if (error instanceof z.ZodError) {
        return apiError(422, 'invalid_request', z.prettifyError(error), 'Choose catalog templates.')
      }
      throw error
    }
  },
})

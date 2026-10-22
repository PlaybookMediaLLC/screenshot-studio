import { randomUUID } from 'node:crypto'
import { APIError, createAuthEndpoint, sensitiveSessionMiddleware } from 'better-auth/api'
import { organization } from 'better-auth/plugins'
import {
  BackendSDKError,
  workspaceCreationLogoSchema,
  workspaceCreationMetadataSchema,
} from 'screenshot-studio-backend-sdk'
import { backendSDK } from '@/lib/backend/sdk'
import { workspaceCreateSchema } from '@/lib/workspace/input-schemas'
import { workspaceInvitationEndpoints } from './workspace-invitations-plugin'

const creationInputSchema = workspaceCreateSchema.strict().extend({
  logo: workspaceCreationLogoSchema.nullish(),
  metadata: workspaceCreationMetadataSchema.optional(),
})

const createWorkspaceOrganizationEndpoint = createAuthEndpoint(
  '/organization/create',
  {
    method: 'POST',
    body: creationInputSchema,
    requireHeaders: true,
    use: [sensitiveSessionMiddleware],
  },
  async (ctx) => {
    const { session, user } = ctx.context.session
    try {
      const result = await backendSDK({
        organizationId: '',
        requestId: randomUUID(),
        principal: {
          kind: 'session',
          display: user.email,
          sessionId: session.id,
          userId: user.id,
        },
      }).createWorkspace(ctx.body)
      return ctx.json({
        ...result.organization,
        createdAt: new Date(result.organization.createdAt),
        members: [
          { ...result.creationMember, createdAt: new Date(result.creationMember.createdAt) },
        ],
      })
    } catch (error) {
      throw creationError(error)
    }
  }
)

function creationError(error: unknown): APIError {
  if (error instanceof BackendSDKError) {
    if (error.status === 400)
      return APIError.fromStatus('BAD_REQUEST', { message: 'Invalid workspace details.' })
    if (error.status === 401)
      return APIError.fromStatus('UNAUTHORIZED', { message: 'Sign in to create a workspace.' })
    if (error.status === 403)
      return APIError.fromStatus('FORBIDDEN', {
        message: 'This workspace request is not available.',
      })
    if (error.status === 409) return APIError.fromStatus('CONFLICT', { message: error.message })
  }
  return APIError.fromStatus('SERVICE_UNAVAILABLE', {
    message: 'Could not confirm workspace creation. Retry with the same details.',
  })
}

/**
 * Retains Better Auth's organization plugin and router protections while giving
 * its creation endpoint the same atomic service used by workspace.create.
 * Replacing the endpoint also covers auth.api.createOrganization server calls.
 */
export function workspaceOrganizationPlugin<
  const Options extends NonNullable<Parameters<typeof organization>[0]>,
>(options: Options) {
  const plugin = organization(options)
  return {
    ...plugin,
    endpoints: {
      ...plugin.endpoints,
      ...workspaceInvitationEndpoints,
      createOrganization: createWorkspaceOrganizationEndpoint,
    },
  }
}

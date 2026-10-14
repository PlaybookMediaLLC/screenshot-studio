import 'server-only'

import type { OrganizationAccess } from '@/lib/auth/access'
import {
  BackendSDKError,
  ScreenshotStudioBackendSDK,
  type OAuthProvider,
  type ScheduledPost,
} from 'screenshot-studio-backend-sdk'

export { BackendSDKError as PublishingBackendError }

type ListedScheduledPost = ScheduledPost & {
  channelConnection: NonNullable<ScheduledPost['channelConnection']>
}

export function publishingBackendEnabled(): boolean {
  return Boolean(process.env.PUBLISHING_API_URL)
}

function sdk(access: OrganizationAccess): ScreenshotStudioBackendSDK {
  return new ScreenshotStudioBackendSDK(
    process.env.PUBLISHING_API_URL ?? '',
    process.env.PUBLISHING_SERVICE_TOKEN ?? '',
    {
      organizationId: access.organizationId,
      requestId: access.requestId,
      sessionId: access.principal.sessionId,
      userId: access.principal.userId,
    }
  )
}

export async function listBackendScheduledPosts(access: OrganizationAccess, limit: number) {
  const result = await sdk(access).listScheduledPosts(limit)
  if (result.items.some((post) => !post.channelConnection)) {
    throw new BackendSDKError('Publishing backend returned an incomplete post.', 503)
  }
  return result.items as ListedScheduledPost[]
}

export async function listBackendConnections(access: OrganizationAccess) {
  const result = await sdk(access).listConnections()
  return result.items
}

export async function createBackendConnection(
  access: OrganizationAccess,
  input: {
    externalAccountId: string
    platform: string
    providerSettings: Record<string, unknown>
    secretReference: string
  }
) {
  return sdk(access).createConnection(input)
}

export async function createBackendScheduledPost(
  access: OrganizationAccess,
  input: {
    caption: string
    channelConnectionId: string
    idempotencyKey: string
    scheduledFor: Date
    variantId: string
  }
) {
  return sdk(access).createScheduledPost(input)
}

export async function cancelBackendScheduledPost(access: OrganizationAccess, id: string) {
  const scheduledPost = await sdk(access).cancelScheduledPost(id)
  return { scheduledPost }
}

export async function beginBackendSocialOAuth(access: OrganizationAccess, provider: OAuthProvider) {
  const result = await sdk(access).beginSocialOAuth(provider)
  return result.url
}

export async function verifyBackendSocialOAuth(
  access: OrganizationAccess,
  provider: OAuthProvider,
  state: string,
  integrationId?: string
) {
  await sdk(access).verifySocialOAuth(provider, state, integrationId)
}

export async function rememberBackendInstagramIntegration(
  access: OrganizationAccess,
  state: string,
  integrationId: string
) {
  await sdk(access).rememberInstagramIntegration(state, integrationId)
}

export async function completeBackendSocialOAuth(
  access: OrganizationAccess,
  provider: OAuthProvider,
  state: string,
  integrationId: string
) {
  await sdk(access).completeSocialOAuth(provider, state, integrationId)
}

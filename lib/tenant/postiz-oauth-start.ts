import 'server-only'

import { Prisma } from '@prisma/client'
import {
  AuthorizationError,
  requireActiveOrganizationPermission,
  requireSensitiveOrganizationPermission,
  type OrganizationAccess,
} from '@/lib/auth/access'
import { prisma } from '@/lib/db'
import { createPostizConnection, ScheduledPostError } from './scheduled-posts'
import { beginPostizOAuth, PostizProviderError } from './postiz'
import type { SocialOAuthProvider } from './postiz-oauth-callback'

const oauthLifetimeMilliseconds = 60 * 60 * 1000
const oauthHosts: Record<SocialOAuthProvider, string> = {
  x: 'api.x.com',
  instagram: 'www.facebook.com',
  'instagram-standalone': 'www.instagram.com',
}

export class SocialOAuthError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409 | 503
  ) {
    super(message)
  }
}

function parseAuthorizationURL(
  raw: string,
  provider: SocialOAuthProvider
): {
  state: string
  url: string
} {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SocialOAuthError('The social provider returned an invalid authorization URL.', 503)
  }
  const state = url.searchParams.get(provider === 'x' ? 'oauth_token' : 'state')
  if (url.protocol !== 'https:' || url.hostname !== oauthHosts[provider] || !state) {
    throw new SocialOAuthError('The social provider returned an invalid authorization URL.', 503)
  }
  return { state, url: url.toString() }
}

export async function startSocialOAuth(
  headers: Headers,
  provider: SocialOAuthProvider
): Promise<string> {
  const active = await requireActiveOrganizationPermission(headers, 'publish:manage')
  const access = await requireSensitiveOrganizationPermission(
    headers,
    active.organizationId,
    'publish:manage'
  )
  const binding = await prisma.postizTenantBinding.findUnique({
    where: { organizationId: access.organizationId },
  })
  if (!binding) throw new SocialOAuthError('Social publishing is not configured.', 409)
  const raw = await beginPostizOAuth({
    expectedGoOrganizationId: binding.goOrganizationId,
    provider,
    secretReference: binding.secretReference,
  })
  const authorization = parseAuthorizationURL(raw, provider)
  await prisma.socialOAuthStart.create({
    data: {
      expiresAt: new Date(Date.now() + oauthLifetimeMilliseconds),
      organizationId: access.organizationId,
      provider,
      secretReference: binding.secretReference,
      sessionId: access.principal.sessionId,
      state: authorization.state,
      userId: access.principal.userId,
    },
  })
  return authorization.url
}

async function getMatchingStart(
  headers: Headers,
  provider: SocialOAuthProvider,
  state: string,
  integrationId?: string
): Promise<{ access: OrganizationAccess; secretReference: string }> {
  const access = await requireActiveOrganizationPermission(headers, 'publish:manage')
  const start = await prisma.socialOAuthStart.findUnique({ where: { state } })
  if (
    !start ||
    start.provider !== provider ||
    start.organizationId !== access.organizationId ||
    start.userId !== access.principal.userId ||
    start.sessionId !== access.principal.sessionId ||
    start.expiresAt <= new Date() ||
    (integrationId !== undefined && start.integrationId !== integrationId)
  ) {
    throw new SocialOAuthError('This social connection expired. Please start again.', 403)
  }
  return { access, secretReference: start.secretReference }
}

export async function verifySocialOAuthStart(
  headers: Headers,
  provider: SocialOAuthProvider,
  state: string,
  integrationId?: string
): Promise<void> {
  await getMatchingStart(headers, provider, state, integrationId)
}

export async function rememberInstagramIntegration(
  headers: Headers,
  state: string,
  integrationId: string
): Promise<void> {
  await getMatchingStart(headers, 'instagram', state)
  const updated = await prisma.socialOAuthStart.updateMany({
    data: { integrationId },
    where: { expiresAt: { gt: new Date() }, integrationId: null, provider: 'instagram', state },
  })
  if (updated.count !== 1) throw new SocialOAuthError('This social connection expired.', 403)
}

export async function registerSocialOAuthDestination(
  headers: Headers,
  provider: SocialOAuthProvider,
  state: string,
  integrationId: string
): Promise<void> {
  const { access, secretReference } = await getMatchingStart(
    headers,
    provider,
    state,
    provider === 'instagram' ? integrationId : undefined
  )
  try {
    await createPostizConnection(access, {
      externalAccountId: integrationId,
      platform: provider,
      providerSettings: {},
      secretReference,
    })
  } catch (error) {
    if (
      !(error instanceof ScheduledPostError) ||
      error.message !== 'This Postiz destination is already connected.'
    ) {
      throw error
    }
    const existing = await prisma.channelConnection.findFirst({
      where: {
        externalAccountId: integrationId,
        organizationId: access.organizationId,
        platform: provider,
        provider: 'postiz',
        secretReference,
      },
    })
    if (!existing) throw error
  }
  await prisma.socialOAuthStart.deleteMany({
    where: { state, organizationId: access.organizationId },
  })
}

export function socialOAuthErrorResponse(error: unknown): Response {
  if (error instanceof SocialOAuthError)
    return new Response(error.message, { status: error.status })
  if (error instanceof AuthorizationError)
    return new Response(error.message, { status: error.status })
  if (error instanceof PostizProviderError || error instanceof ScheduledPostError) {
    return new Response('Social publishing is unavailable for this workspace.', { status: 409 })
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new Response('This social connection is already in progress.', { status: 409 })
  }
  return new Response('Social connection failed. Please start again.', { status: 502 })
}

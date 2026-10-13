import { completeSocialOAuth, selectInstagramAccount } from '@/lib/tenant/postiz-oauth-callback'
import {
  registerSocialOAuthDestination,
  rememberInstagramIntegration,
  socialOAuthErrorResponse,
  verifySocialOAuthStart,
} from '@/lib/tenant/postiz-oauth-start'

type Context = { params: Promise<{ provider: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  const { provider } = await context.params
  if (!['x', 'instagram', 'instagram-standalone'].includes(provider)) {
    return new Response('Provider not found.', { status: 404 })
  }
  const state = new URL(request.url).searchParams.get(provider === 'x' ? 'oauth_token' : 'state')
  if (!state) return new Response('Social connection was not completed.', { status: 400 })
  try {
    await verifySocialOAuthStart(
      request.headers,
      provider as 'x' | 'instagram' | 'instagram-standalone',
      state
    )
    return await completeSocialOAuth(request, provider, {
      onConnected: (oauthState, integrationId) =>
        registerSocialOAuthDestination(
          request.headers,
          provider as 'x' | 'instagram-standalone',
          oauthState,
          integrationId
        ),
      onPageChoice: (oauthState, integrationId) =>
        rememberInstagramIntegration(request.headers, oauthState, integrationId),
    })
  } catch (error) {
    return socialOAuthErrorResponse(error)
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { provider } = await context.params
  if (provider !== 'instagram') return new Response('Provider not found.', { status: 404 })
  try {
    return await selectInstagramAccount(request, {
      beforeSelect: (state, integrationId) =>
        verifySocialOAuthStart(request.headers, 'instagram', state, integrationId),
      onSelected: (state, integrationId) =>
        registerSocialOAuthDestination(request.headers, 'instagram', state, integrationId),
    })
  } catch (error) {
    return socialOAuthErrorResponse(error)
  }
}

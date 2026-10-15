import { completeSocialOAuth, selectInstagramAccount } from '@/lib/tenant/postiz-oauth-callback'
import {
  exchangeSocialOAuthCallback,
  registerSocialOAuthDestination,
  rememberInstagramIntegration,
  selectInstagramOAuthPage,
  socialOAuthErrorResponse,
} from '@/lib/tenant/postiz-oauth-start'

type Context = { params: Promise<{ provider: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  const { provider } = await context.params
  if (!['x', 'instagram', 'instagram-standalone', 'linkedin'].includes(provider)) {
    return new Response('Provider not found.', { status: 404 })
  }
  try {
    return await completeSocialOAuth(request, provider, {
      exchange: (oauthState, code) =>
        exchangeSocialOAuthCallback(
          request.headers,
          provider as 'x' | 'instagram' | 'instagram-standalone' | 'linkedin',
          oauthState,
          code
        ),
      onConnected: (oauthState, integrationId) =>
        registerSocialOAuthDestination(
          request.headers,
          provider as 'x' | 'instagram-standalone' | 'linkedin',
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
      selectPage: ({ state, integrationId, accountId, pageId }) =>
        selectInstagramOAuthPage(request.headers, { state, integrationId, accountId, pageId }),
      onSelected: (state, integrationId) =>
        registerSocialOAuthDestination(request.headers, 'instagram', state, integrationId),
    })
  } catch (error) {
    return socialOAuthErrorResponse(error)
  }
}

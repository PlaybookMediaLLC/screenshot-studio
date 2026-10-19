import { isSocialOAuthProvider } from '@/lib/tenant/social-oauth-callback'
import { socialOAuthErrorResponse, startSocialOAuth } from '@/lib/tenant/social-oauth-start'

type Context = { params: Promise<{ provider: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  const { provider } = await context.params
  if (!isSocialOAuthProvider(provider)) {
    return new Response('Provider not found.', { status: 404 })
  }
  try {
    const destination = await startSocialOAuth(request.headers, provider)
    return new Response(null, {
      headers: { 'Cache-Control': 'no-store', Location: destination },
      status: 303,
    })
  } catch (error) {
    return socialOAuthErrorResponse(error)
  }
}

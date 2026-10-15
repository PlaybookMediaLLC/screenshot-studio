import { socialOAuthErrorResponse, startSocialOAuth } from '@/lib/tenant/postiz-oauth-start'

type Context = { params: Promise<{ provider: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  const { provider } = await context.params
  if (!['x', 'instagram', 'instagram-standalone', 'linkedin'].includes(provider)) {
    return new Response('Provider not found.', { status: 404 })
  }
  try {
    const destination = await startSocialOAuth(
      request.headers,
      provider as 'x' | 'instagram' | 'instagram-standalone' | 'linkedin'
    )
    return new Response(null, {
      headers: { 'Cache-Control': 'no-store', Location: destination },
      status: 303,
    })
  } catch (error) {
    return socialOAuthErrorResponse(error)
  }
}

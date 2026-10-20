import { isSocialOAuthProvider, SOCIAL_OAUTH_RETURN_COOKIE } from '@/lib/tenant/social-oauth-callback'
import { socialOAuthErrorResponse, startSocialOAuth } from '@/lib/tenant/social-oauth-start'

type Context = { params: Promise<{ provider: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  const { provider } = await context.params
  if (!isSocialOAuthProvider(provider)) {
    return new Response('Provider not found.', { status: 404 })
  }
  const socialSet = new URL(request.url).searchParams.get('socialSet')
  const socialSetId = socialSet && /^[a-z0-9]{10,32}$/.test(socialSet) ? socialSet : undefined
  try {
    const destination = await startSocialOAuth(request.headers, provider, socialSetId)
    const headers = new Headers({ 'Cache-Control': 'no-store', Location: destination })
    if (socialSetId) {
      headers.append(
        'Set-Cookie',
        `${SOCIAL_OAUTH_RETURN_COOKIE}=${encodeURIComponent(`/workspace/social-sets/${socialSetId}`)}; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax`
      )
    }
    return new Response(null, { headers, status: 303 })
  } catch (error) {
    return socialOAuthErrorResponse(error)
  }
}

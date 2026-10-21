import {
  isSocialOAuthProvider,
  SOCIAL_OAUTH_RETURN_COOKIE,
  socialOAuthReturnSchema,
} from '@/lib/tenant/social-oauth-callback'
import { socialOAuthErrorResponse, startSocialOAuth } from '@/lib/tenant/social-oauth-start'

type Context = { params: Promise<{ provider: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  const { provider } = await context.params
  if (!isSocialOAuthProvider(provider)) {
    return new Response('Provider not found.', { status: 404 })
  }
  const query = new URL(request.url).searchParams
  const socialSet = query.get('socialSet')
  const back = socialOAuthReturnSchema.safeParse(query.get('returnTo'))
  const socialSetId = socialSet && /^[a-z0-9]{10,32}$/.test(socialSet) ? socialSet : undefined
  try {
    const destination = await startSocialOAuth(request.headers, provider, socialSetId)
    const headers = new Headers({ 'Cache-Control': 'no-store', Location: destination })
    const returnTo = back.success
      ? back.data
      : socialSetId
        ? `/workspace/social-sets/${socialSetId}`
        : ''
    headers.append(
      'Set-Cookie',
      `${SOCIAL_OAUTH_RETURN_COOKIE}=${encodeURIComponent(returnTo)}; Path=/; Max-Age=${returnTo ? 3600 : 0}; HttpOnly; SameSite=Lax`
    )
    return new Response(null, { headers, status: 303 })
  } catch (error) {
    return socialOAuthErrorResponse(error)
  }
}

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { isUnacceptable, prefersMarkdown } from './lib/agents/accept'
import { renderNotAcceptableMarkdown } from './lib/agents/site-content'

const handleI18nRouting = createMiddleware(routing)

function appendVaryAccept(headers: Headers): void {
  const existing = headers.get('Vary')
  if (!existing) {
    headers.set('Vary', 'Accept, Accept-Encoding')
    return
  }

  const parts = existing.split(',').map((part) => part.trim())
  if (parts.some((part) => part.toLowerCase() === 'accept')) return
  headers.set('Vary', [...parts, 'Accept'].join(', '))
}

function isFrameworkRequest(request: NextRequest): boolean {
  return (
    request.headers.has('RSC') ||
    request.headers.has('Next-Router-Prefetch') ||
    request.headers.has('Next-Router-State-Tree')
  )
}

function isStandaloneLocaleRewrite(request: NextRequest): boolean {
  const prefix = `/${routing.defaultLocale}`
  return (
    request.headers.get('x-next-intl-locale') === routing.defaultLocale &&
    (request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`))
  )
}

export function proxy(request: NextRequest): Response {
  // Next standalone currently re-enters Proxy for internal rewrites. next-intl
  // marks its first pass with this header, so let that internal default-locale
  // path reach the app instead of canonicalizing it back into a 307 loop.
  // https://github.com/vercel/next.js/issues/95528
  if (isStandaloneLocaleRewrite(request)) {
    return NextResponse.next()
  }

  const accept = request.headers.get('accept')
  const negotiable =
    (request.method === 'GET' || request.method === 'HEAD') && !isFrameworkRequest(request)

  if (negotiable && prefersMarkdown(accept)) {
    const url = request.nextUrl.clone()
    url.pathname = `/api/md${request.nextUrl.pathname === '/' ? '/__root__' : request.nextUrl.pathname}`
    url.search = ''
    return NextResponse.rewrite(url)
  }

  if (negotiable && isUnacceptable(accept)) {
    return new NextResponse(renderNotAcceptableMarkdown(accept ?? ''), {
      status: 406,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        Vary: 'Accept, Accept-Encoding',
      },
    })
  }

  const response = handleI18nRouting(request)
  appendVaryAccept(response.headers)
  response.headers.set(
    'Link',
    `<${request.nextUrl.pathname}>; rel="alternate"; type="text/markdown"`
  )
  return response
}

export const config = {
  matcher: [
    '/((?!api|_next|_vercel|r2-assets|svc|llms\\.txt|llms-full\\.txt|openapi\\.json|robots\\.txt|sitemap\\.xml|.*\\..*).*)',
  ],
}

import type { NextRequest } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

const handleI18nRouting = createMiddleware(routing)

export function proxy(request: NextRequest): Response {
  return handleI18nRouting(request)
}

export const config = {
  matcher: [
    '/((?!api|_next|_vercel|r2-assets|svc|llms\\.txt|llms-full\\.txt|robots\\.txt|sitemap\\.xml|.*\\..*).*)',
  ],
}

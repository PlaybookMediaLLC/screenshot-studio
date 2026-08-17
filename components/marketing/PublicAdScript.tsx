'use client'

import { usePathname } from 'next/navigation'
import Script from 'next/script'

const applicationPath =
  /^(?:\/(?:settings|workspace|onboarding|sign-in|sign-up|accept-invitation)(?:\/|$)|\/$)/

function getPathWithoutLocale(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?(?=\/|$)/, '') || '/'
}

export function PublicAdScript(): React.JSX.Element | null {
  const pathname = usePathname()
  if (applicationPath.test(getPathWithoutLocale(pathname))) return null

  return (
    <Script
      async
      crossOrigin="anonymous"
      src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8704843786311642"
      strategy="lazyOnload"
    />
  )
}

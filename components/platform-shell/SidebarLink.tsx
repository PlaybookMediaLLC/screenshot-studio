'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ComponentProps, useState } from 'react'

/** Prefetch sidebar destinations only after hover or keyboard focus. */
export function SidebarLink({
  href,
  onMouseEnter,
  onFocus,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'> & { href: string }) {
  const pathname = usePathname()
  const [intentPath, setIntentPath] = useState<string | null>(null)
  const currentPath = pathname.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?(?=\/|$)/, '') || '/'
  // Editor section links change query parameters locally without fetching a page.
  const isCurrentPage = currentPath === href.split(/[?#]/)[0]

  return (
    <Link
      {...props}
      href={href}
      prefetch={!isCurrentPage && intentPath === pathname ? null : false}
      onMouseEnter={(event) => {
        setIntentPath(pathname)
        onMouseEnter?.(event)
      }}
      onFocus={(event) => {
        setIntentPath(pathname)
        onFocus?.(event)
      }}
    />
  )
}

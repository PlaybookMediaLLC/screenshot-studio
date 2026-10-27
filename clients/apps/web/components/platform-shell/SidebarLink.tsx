'use client'

import Link from 'next/link'
import { platformHref } from '@/lib/platform/navigation'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { hasLinkNavigationGuards, prepareLinkNavigation } from '@/lib/platform/navigation-guard'
import { type ComponentProps, useState } from 'react'

/** Prefetch sidebar destinations only after hover or keyboard focus. */
export function SidebarLink({
  href,
  onMouseEnter,
  onFocus,
  onNavigate,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'> & { href: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [intentPath, setIntentPath] = useState<string | null>(null)
  const currentPath = pathname.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?(?=\/|$)/, '') || '/'
  // Editor section links change query parameters locally without fetching a page.
  const isCurrentPage = currentPath === href.split(/[?#]/)[0]

  return (
    <Link
      {...props}
      href={platformHref(pathname, href)}
      prefetch={!isCurrentPage && intentPath === pathname ? null : false}
      onNavigate={(event) => {
        let handled = false
        onNavigate?.({
          preventDefault: () => {
            handled = true
            event.preventDefault()
          },
        })
        if (handled) return
        if (!hasLinkNavigationGuards()) return
        event.preventDefault()
        void prepareLinkNavigation()
          .then(() => router.push(platformHref(pathname, href)))
          .catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : 'Save your work before leaving.')
          })
      }}
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

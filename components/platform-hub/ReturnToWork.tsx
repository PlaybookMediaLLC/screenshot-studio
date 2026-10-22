'use client'

import { useSearchParams } from 'next/navigation'
import { safeReturnPath } from '@/lib/platform/navigation'
import { SidebarLink } from '@/components/platform-shell/SidebarLink'

/** Returning never bypasses the destination's authorization or dirty-work guard. */
export function ReturnToWork() {
  const target = useSearchParams().get('returnTo')
  if (!target || safeReturnPath(target, '') === '') return null
  return (
    <SidebarLink
      className="inline-flex min-h-10 items-center text-sm underline"
      href={safeReturnPath(target)}
    >
      ← Return to your work
    </SidebarLink>
  )
}

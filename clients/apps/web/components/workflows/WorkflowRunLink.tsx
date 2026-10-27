'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'

/** Run rows prefetch on pointer or keyboard intent, never on viewport entry. */
export function WorkflowRunLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: ReactNode
}) {
  const [active, setActive] = useState(false)
  return (
    <Link
      href={href}
      className={className}
      prefetch={active ? null : false}
      onMouseEnter={() => setActive(true)}
      onFocus={() => setActive(true)}
    >
      {children}
    </Link>
  )
}

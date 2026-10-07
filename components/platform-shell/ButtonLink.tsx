'use client'

import Link from 'next/link'
import type { ComponentProps } from 'react'
import type { VariantProps } from 'class-variance-authority'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * A link styled as a button. The upstream Button's `asChild` wraps children
 * in a fragment, so the Slot drops the button classes; this sidesteps it
 * without patching the upstream component.
 */
export function ButtonLink({
  className,
  size,
  variant,
  ...props
}: ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ size, variant }), className)} {...props} />
}

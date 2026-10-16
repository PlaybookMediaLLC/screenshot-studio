'use client'

import Link from 'next/link'
import { ArrowRight01Icon } from 'hugeicons-react'
import { trackCTAClick } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { ctaToneSchema, type CtaTone } from './primitives'

const TONES: Record<CtaTone, string> = {
  primary: 'bg-white text-black hover:bg-white/90',
  secondary: 'border border-white/15 text-white hover:border-white/30 hover:bg-white/[0.04]',
}

/** The pill style CTA links and buttons share. */
export function ctaClassName(tone: CtaTone): string {
  return cn(
    'group inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full pl-5 pr-4 text-[15px] font-medium tracking-[-0.01em] transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
    TONES[tone]
  )
}

/** A pill link that records which landing section the click came from. */
export function CtaLink({
  className,
  href,
  label,
  location,
  tone = ctaToneSchema.enum.primary,
}: {
  className?: string
  href: string
  label: string
  location: string
  tone?: CtaTone
}) {
  return (
    <Link
      className={cn(ctaClassName(tone), className)}
      href={href}
      onClick={() => trackCTAClick(location, label)}
    >
      {label}
      <ArrowRight01Icon
        aria-hidden="true"
        className="size-4 transition-transform duration-150 group-hover:translate-x-0.5"
      />
    </Link>
  )
}

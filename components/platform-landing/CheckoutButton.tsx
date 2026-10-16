'use client'

import { useState } from 'react'
import type { z } from 'zod'
import { trackCTAClick } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { ctaClassName } from './CtaLink'
import { type checkoutPathSchema, ctaToneSchema } from './primitives'

/**
 * Opens Stripe Checkout (or the billing portal) for the signed-in workspace.
 * The first choice is the main button; the rest are quiet text buttons, e.g.
 * annual billing. Signed-out visitors sign in first; until Stripe is
 * configured, the request falls back to the contact page.
 */
export function CheckoutButton({
  choices,
  className,
  location,
  path,
}: {
  choices: { body: Record<string, string>; label: string }[]
  className?: string
  location: string
  path: z.infer<typeof checkoutPathSchema>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start(choice: (typeof choices)[number]) {
    trackCTAClick(location, choice.label)
    setBusy(true)
    setError(null)
    const response = await fetch(path, {
      body: JSON.stringify(choice.body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as {
      message?: string
      url?: string
    } | null
    if (response?.ok && body?.url) return window.location.assign(body.url)
    if (response?.status === 401) {
      return window.location.assign(`/sign-in?callbackURL=${encodeURIComponent('/pricing')}`)
    }
    if (response?.status === 503) return window.location.assign('/contact')
    setError(body?.message ?? 'Checkout could not start. Try again.')
    setBusy(false)
  }

  const [main, ...others] = choices
  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <button
        className={cn(
          ctaClassName(ctaToneSchema.enum.secondary),
          'w-full justify-center disabled:opacity-60'
        )}
        disabled={busy}
        onClick={() => start(main)}
        type="button"
      >
        {main.label}
      </button>
      {others.map((choice) => (
        <button
          className="text-[13px] text-white/60 underline-offset-4 hover:text-white hover:underline disabled:opacity-60"
          disabled={busy}
          key={choice.label}
          onClick={() => start(choice)}
          type="button"
        >
          {choice.label}
        </button>
      ))}
      {error ? (
        <p className="text-center text-[13px] text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

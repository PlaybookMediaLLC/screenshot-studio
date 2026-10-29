'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'
import { ReturnToWork } from '@/components/platform-hub/ReturnToWork'
import { Alert, AlertDescription } from '@/components/ui/alert'

/** What a visit to /pricing tells the buyer, keyed by `param=value` from the URL. */
const OUTCOMES: Record<string, string> = {
  'checkout=cancelled': 'Checkout was cancelled. You have not been charged.',
  'checkout=pending': "Payment received. We're finishing setup — this page will refresh.",
  'checkout=success': 'You are subscribed. Welcome to Shots.',
  'credits=cancelled': 'The credit purchase was cancelled. You have not been charged.',
  'credits=success': 'Payment received. Your extra launch credits are on the way.',
  'subscribe=required': 'This capability requires a paid plan.',
}

const POLL_MS = 3_000
const POLL_LIMIT_MS = 60_000

/**
 * While Stripe finishes activating a subscription, checks the workspace's
 * plan every few seconds and opens the app once it is paid, or after a
 * minute either way (the app sends an unpaid workspace back here).
 */
function useOpenAppWhenPaid(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const startedAt = Date.now()
    const timer = window.setInterval(async () => {
      const response = await fetch('/api/v1/bootstrap').catch(() => null)
      const body = (await response?.json().catch(() => null)) as {
        entitlements?: { features?: Record<string, boolean> }
      } | null
      if (
        body?.entitlements?.features?.['workspace:paid'] ||
        Date.now() - startedAt > POLL_LIMIT_MS
      ) {
        window.clearInterval(timer)
        window.location.assign('/')
      }
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [enabled])
}

function Notice() {
  const searchParams = useSearchParams()
  const key = ['subscribe', 'checkout', 'credits']
    .map((param) => `${param}=${searchParams.get(param)}`)
    .find((candidate) => OUTCOMES[candidate])
  useOpenAppWhenPaid(key === 'checkout=pending')
  if (!key) return null
  return (
    <Alert className="mb-6 rounded-none border-white/15 bg-[#181818] px-5 py-4 text-white">
      <AlertDescription className="text-[15px] text-white/85">{OUTCOMES[key]}</AlertDescription>
    </Alert>
  )
}

/**
 * The pricing page's notice for a redirect from the paywall, Checkout, or a
 * credit purchase, and the way back to the app for someone sent from it.
 */
export function PricingNotice() {
  return (
    <Suspense fallback={null}>
      <ReturnToWork />
      <Notice />
    </Suspense>
  )
}

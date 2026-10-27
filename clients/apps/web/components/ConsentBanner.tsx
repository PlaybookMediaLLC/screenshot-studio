'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { CONSENT_OPEN_EVENT, gpcEnabled, openConsentSettings, readConsent, writeConsent } from '@/lib/consent'

/** Asks once for analytics and advertising consent; "Cookie settings" links reopen it. */
export function ConsentBanner() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!readConsent()) setOpen(true)
    const reopen = () => setOpen(true)
    window.addEventListener(CONSENT_OPEN_EVENT, reopen)
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen)
  }, [])

  if (!open) return null

  const choose = (accepted: boolean) => {
    writeConsent({ analytics: accepted, ads: accepted })
    setOpen(false)
  }

  return (
    <div
      aria-label="Cookie consent"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-xl rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground shadow-lg"
      role="dialog"
    >
      <p>
        We use cookies to keep you signed in. With your OK we also use analytics and, on content
        pages, ads.{gpcEnabled() ? ' Your browser’s privacy signal keeps ads off.' : ''}{' '}
        <Link className="underline underline-offset-4 hover:text-foreground" href="/privacy-policy">
          Privacy policy
        </Link>
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={() => choose(false)} size="sm" variant="outline">
          Reject
        </Button>
        <Button onClick={() => choose(true)} size="sm">
          Accept
        </Button>
      </div>
    </div>
  )
}

/** Footer link that reopens the consent banner. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <Button variant="custom" size={null} className={className} onClick={openConsentSettings} type="button">
      Cookie settings
    </Button>
  )
}

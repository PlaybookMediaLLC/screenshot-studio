import posthog from 'posthog-js'
import { scrubEvent } from '@/lib/analytics-scrub'
import { CONSENT_CHANGE_EVENT, readConsent, type Consent } from '@/lib/consent'

// Deployments without analytics leave the key unset. Initializing with
// an empty token makes PostHog log a misconfiguration error on every
// page, so skip initialization instead.
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY

if (posthogKey) {
  // PostHog loads only after the visitor accepts analytics: no request,
  // cookie or storage entry exists before that.
  let started = false
  const apply = (consent: Consent | null) => {
    if (!consent?.analytics) {
      if (started) posthog.opt_out_capturing()
      return
    }
    if (started) return posthog.opt_in_capturing({ captureEventName: false })
    started = true
    posthog.init(posthogKey, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      ui_host: 'https://us.posthog.com',
      defaults: '2026-01-30',
      before_send: scrubEvent,
    })
  }
  apply(readConsent())
  window.addEventListener(CONSENT_CHANGE_EVENT, (event) =>
    apply((event as CustomEvent<Consent>).detail)
  )
}

import posthog from 'posthog-js'
import { scrubEvent } from '@/lib/analytics-scrub'
import { CONSENT_CHANGE_EVENT, readConsent, type Consent } from '@/lib/consent'
import { canvasNavigationFailure } from '@/lib/canvas/navigation-diagnostics'

// Observe the request without changing Next's fetch or deployment-skew handling.
try {
  if (
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes.includes('resource')
  ) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const failure = canvasNavigationFailure(
          entry as PerformanceResourceTiming,
          window.location.origin
        )
        if (!failure) continue
        console.warn('[Canvas navigation] Page data request failed', failure)
        if (process.env.NEXT_PUBLIC_POSTHOG_KEY && readConsent()?.analytics)
          posthog.capture('canvas_navigation_failed', failure)
      }
    }).observe({ type: 'resource', buffered: true })
  }
} catch {
  // Monitoring must never prevent the editor from loading.
}

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
      // The project's remote config turned recording on for every page: an extra
      // script and network traffic on each navigation, and the only console error
      // (React #441, from inside the recorder). Events still flow.
      disable_session_recording: true,
      before_send: scrubEvent,
    })
  }
  apply(readConsent())
  window.addEventListener(CONSENT_CHANGE_EVENT, (event) =>
    apply((event as CustomEvent<Consent>).detail)
  )
}

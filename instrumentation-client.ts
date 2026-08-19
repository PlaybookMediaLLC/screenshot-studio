import posthog from 'posthog-js'

// Deployments without analytics leave the key unset. Initializing with
// an empty token makes PostHog log a misconfiguration error on every
// page, so skip initialization instead.
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY

if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    ui_host: 'https://us.posthog.com',
    defaults: '2026-01-30',
  })
}

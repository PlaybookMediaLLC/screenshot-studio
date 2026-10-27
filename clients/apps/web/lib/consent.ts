import { z } from 'zod'

/**
 * Cookie consent. Analytics (PostHog) and advertising (AdSense) stay off until
 * the visitor accepts them in the banner. The choice lives in local storage,
 * and changes are broadcast so loaders already on the page can react.
 */

/** A visitor's saved choice for each optional cookie category. */
export const consentSchema = z.object({ analytics: z.boolean(), ads: z.boolean() })

/** A visitor's saved choice for each optional cookie category. */
export type Consent = z.infer<typeof consentSchema>

const STORAGE_KEY = 'shots-consent'

/** Window event fired after the visitor saves a choice. */
export const CONSENT_CHANGE_EVENT = 'shots-consent-change'

/** Window event that reopens the banner from a "Cookie settings" link. */
export const CONSENT_OPEN_EVENT = 'shots-consent-open'

/** True when the browser sends a Global Privacy Control opt-out signal. */
export function gpcEnabled(): boolean {
  if (typeof navigator === 'undefined') return false
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
}

/** The saved choice, or null when the visitor has not chosen yet. */
export function readConsent(): Consent | null {
  if (typeof window === 'undefined') return null
  try {
    const parsed = consentSchema.safeParse(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null'))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Saves a choice and tells listeners. GPC always turns advertising off. */
export function writeConsent(consent: Consent): void {
  const saved = { analytics: consent.analytics, ads: consent.ads && !gpcEnabled() }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Storage can be blocked; the choice still applies to this page.
  }
  window.dispatchEvent(new CustomEvent<Consent>(CONSENT_CHANGE_EVENT, { detail: saved }))
}

/** Reopens the consent banner. */
export function openConsentSettings(): void {
  window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))
}

/** True when advertising may load: the visitor accepted it and sends no GPC signal. */
export function adsAllowed(consent: Consent | null): boolean {
  return consent?.ads === true && !gpcEnabled()
}

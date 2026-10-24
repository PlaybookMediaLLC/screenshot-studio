import { z } from 'zod'

/** How current a product page's screenshot is: `never` until its first capture. */
export const surfaceFreshnessSchema = z.enum(['fresh', 'stale', 'never'])

/** How current a product page's screenshot is. */
export type SurfaceFreshness = z.infer<typeof surfaceFreshnessSchema>

/** A capture older than this is stale (RFC 018). */
export const SURFACE_FRESH_DAYS = 30

const DAY_MS = 86_400_000

/** Fresh within 30 days of the last capture, stale after, never without one. */
export function surfaceFreshness(
  lastCapturedAt: Date | string | null,
  now: Date = new Date()
): SurfaceFreshness {
  if (!lastCapturedAt) return 'never'
  const age = now.getTime() - new Date(lastCapturedAt).getTime()
  return age < SURFACE_FRESH_DAYS * DAY_MS ? 'fresh' : 'stale'
}

const CAPTURE_FAILURES: Record<string, string> = {
  asset_unavailable: 'The screenshot was taken but could not be stored.',
  capture_failed: 'The page could not be captured.',
  capture_requires_auth: 'The page needs a login, which capture does not support yet.',
  capture_selector_missing: 'The page changed; the part to capture was not found.',
  capture_timeout: 'The page took too long to load.',
  surface_host_rejected: 'The URL is no longer on a registered product host.',
  surface_unreachable: 'The page could not be reached.',
}

/** A last-capture failure code as a sentence; unknown codes still read. */
export function captureFailureMessage(code: string): string {
  return Object.hasOwn(CAPTURE_FAILURES, code)
    ? CAPTURE_FAILURES[code]!
    : `The last capture failed (${code.replaceAll('_', ' ')}).`
}

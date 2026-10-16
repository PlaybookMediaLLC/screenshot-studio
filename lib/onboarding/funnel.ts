import { z } from 'zod'
import { trackEvent } from '@/lib/analytics'

/**
 * The onboarding funnel (docs/rfcs/032-background-onboarding-agent.md,
 * observability): a URL or manual description submitted, the profile
 * confirmed, and the first campaign ready to approve.
 */
export const onboardingEventSchema = z.enum([
  'onboarding_product_started',
  'onboarding_profile_confirmed',
  'onboarding_campaign_ready',
])

/** One of {@link onboardingEventSchema}. */
export type OnboardingEvent = z.infer<typeof onboardingEventSchema>

/** Record an onboarding funnel step. Browser only; a no-op elsewhere. */
export function trackOnboarding(
  event: OnboardingEvent,
  data?: Record<string, string | number | boolean>
): void {
  trackEvent(event, data)
}

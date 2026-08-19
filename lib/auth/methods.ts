import { z } from 'zod'
import { getSocialProviderCredentials } from './environment'

/**
 * Which sign-in methods this deployment offers.
 *
 * Password auth depends on outbound email: verification and reset both
 * send links, so enabling passwords without a mail webhook produces
 * accounts that can never be verified and passwords that can never be
 * reset. Social sign-in has no such dependency, because the provider
 * has already verified the address.
 */

export const SOCIAL_PROVIDERS = ['google', 'github', 'microsoft'] as const

export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number]

const passwordAuthSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value !== 'false')

/**
 * Password auth is on by default so local development and self-hosted
 * deployments keep working without extra configuration. Production
 * disables it explicitly via `AUTH_ENABLE_PASSWORD=false`.
 */
export function isPasswordAuthEnabled(): boolean {
  return passwordAuthSchema.parse(process.env.AUTH_ENABLE_PASSWORD)
}

export function getEnabledSocialProviders(): SocialProvider[] {
  return SOCIAL_PROVIDERS.filter((provider) =>
    Boolean(
      getSocialProviderCredentials(provider.toUpperCase() as 'GOOGLE' | 'GITHUB' | 'MICROSOFT')
    )
  )
}

/**
 * Guards against a deployment that offers no way in at all. Disabling
 * passwords before configuring an OAuth provider would lock out every
 * user, including administrators, so the two settings are validated
 * together rather than independently.
 */
export function assertSignInMethodAvailable(): void {
  if (isPasswordAuthEnabled() || getEnabledSocialProviders().length > 0) {
    return
  }

  throw new Error(
    'No sign-in method is configured. Enable password auth or configure at least one OAuth provider.'
  )
}

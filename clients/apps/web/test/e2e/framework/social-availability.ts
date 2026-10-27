import { z } from 'zod'
import {
  connectionAvailabilitySchema,
  connectionProviderSchema,
  providerAvailabilitySchema,
} from 'screenshot-studio-backend-sdk'

/** Explicit adapter protocol fixture; this is configuration readiness, not live verification. */
export function connectionAvailabilityFixture(
  overrides: Partial<
    Record<
      z.output<typeof connectionProviderSchema>,
      z.output<typeof providerAvailabilitySchema>['status']
    >
  > = {}
) {
  return connectionAvailabilitySchema.parse({
    version: 1,
    providers: connectionProviderSchema.options.map((provider) => ({
      provider,
      status: overrides[provider] ?? (provider === 'substack' ? 'unsupported' : 'available'),
    })),
  })
}

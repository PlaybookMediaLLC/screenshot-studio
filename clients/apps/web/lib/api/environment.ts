import { z } from 'zod'

/** Where the client IP comes from. `digitalocean` trusts only `do-connecting-ip`. */
export const clientIpSourceSchema = z.enum(['digitalocean', 'proxy'])

/** One of {@link clientIpSourceSchema}. */
export type ClientIpSource = z.infer<typeof clientIpSourceSchema>

/**
 * Environment variables the platform API reads. Every value is optional so a
 * missing secret fails the request that needs it, not the whole process.
 */
export const platformApiEnvironmentSchema = z.object({
  BILLING_ENTITLEMENT_WEBHOOK_SECRET: z.string().min(1).optional().catch(undefined),
  CLEANUP_SECRET: z.string().min(1).optional().catch(undefined),
  CLIENT_IP_SOURCE: clientIpSourceSchema.catch('proxy'),
})

/** One of {@link platformApiEnvironmentSchema}. */
export type PlatformApiEnvironment = z.infer<typeof platformApiEnvironmentSchema>

/**
 * Parse the platform API environment. Read on every call, because operators
 * and tests may change these values while the process runs.
 */
export function getPlatformApiEnvironment(): PlatformApiEnvironment {
  return platformApiEnvironmentSchema.parse({
    BILLING_ENTITLEMENT_WEBHOOK_SECRET: process.env.BILLING_ENTITLEMENT_WEBHOOK_SECRET,
    CLEANUP_SECRET: process.env.CLEANUP_SECRET,
    CLIENT_IP_SOURCE: process.env.CLIENT_IP_SOURCE,
  })
}

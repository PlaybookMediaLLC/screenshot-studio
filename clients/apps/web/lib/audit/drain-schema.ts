import { z } from 'zod'

const drainProviderSchema = z.enum(['GENERIC', 'SPLUNK', 'DATADOG'])

export const auditDrainListSchema = z.object({
  organizationId: z.string().min(1).max(128),
})

export const auditDrainCreateSchema = auditDrainListSchema.extend({
  endpoint: z.string().url().max(2_000),
  name: z.string().trim().min(1).max(100),
  provider: drainProviderSchema.default('GENERIC'),
  signingSecret: z.string().min(16).max(1_024),
})

export type AuditDrainCreateInput = z.infer<typeof auditDrainCreateSchema>

export function validateDrainEndpoint(endpoint: string): void {
  const url = new URL(endpoint)
  const blockedHosts = ['127.0.0.1', '169.254.169.254', 'localhost', '::1']
  if (blockedHosts.includes(url.hostname) || url.hostname.endsWith('.local')) {
    throw new Error('Audit drain endpoint must not target a local address.')
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('Audit drain endpoint must use HTTPS in production.')
  }
}

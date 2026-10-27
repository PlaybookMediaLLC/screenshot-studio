import { createHmac } from 'node:crypto'
import { getClientIp } from '@/lib/api/client-identity'

function getAuditIpHashSecret(): string | undefined {
  return process.env.AUDIT_IP_HASH_SECRET
}

export function getAuditIpHash(headers: Headers): string | undefined {
  const clientIp = getClientIp(headers)
  const secret = getAuditIpHashSecret()
  if (!clientIp || !secret) {
    return undefined
  }

  return createHmac('sha256', secret).update(clientIp).digest('hex')
}

export function getUserAgentSummary(headers: Headers): string | undefined {
  return headers.get('user-agent')?.slice(0, 256) ?? undefined
}

/**
 * The request facts every audited write records: a keyed hash of the client
 * IP and a bounded user-agent string.
 */
export function getAuditRequestMetadata(headers: Headers) {
  return { ipHash: getAuditIpHash(headers), userAgentSummary: getUserAgentSummary(headers) }
}

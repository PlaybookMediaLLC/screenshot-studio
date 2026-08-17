import { createHmac } from 'node:crypto'

function getClientIp(headers: Headers): string | null {
  return headers.get('cf-connecting-ip') ?? headers.get('x-forwarded-for')?.split(',', 1)[0] ?? null
}

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

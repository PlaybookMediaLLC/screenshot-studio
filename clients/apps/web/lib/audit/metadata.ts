const sensitiveKey = /assertion|authorization|cookie|password|private|secret|signed.?url|token/i

export type AuditMetadata = Record<string, boolean | null | number | string>

export function sanitizeAuditMetadata(metadata: AuditMetadata = {}): AuditMetadata {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      sensitiveKey.test(key) ? '[REDACTED]' : value,
    ])
  )
}

export function buildAuditSearchText(values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .slice(0, 1_000)
}

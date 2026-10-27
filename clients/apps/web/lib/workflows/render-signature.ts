import { createHmac, timingSafeEqual } from 'node:crypto'

/** Signatures older than this are replays, not requests. */
const MAX_SKEW_SECONDS = 300

/**
 * Checks `t=<unix>,v1=<hex>`: an HMAC-SHA256 over `<t>.<body>` with the
 * shared PLATFORM_WORKFLOW_RENDER_KEY, made by the Go worker.
 */
export function verifyWorkflowRenderSignature(
  body: string,
  header: string | null,
  key: string,
  now = Date.now()
): boolean {
  if (!header || key.length < 32) return false
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=', 2)))
  const stamp = Number(parts.t)
  if (!Number.isInteger(stamp) || Math.abs(now / 1000 - stamp) > MAX_SKEW_SECONDS) return false
  const expected = createHmac('sha256', key).update(`${parts.t}.${body}`).digest('hex')
  const supplied = Buffer.from(String(parts.v1 ?? ''))
  return supplied.length === expected.length && timingSafeEqual(supplied, Buffer.from(expected))
}

import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyBillingSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false
  const supplied = signature.replace(/^sha256=/, '')
  const expected = createHmac('sha256', secret).update(body).digest('hex')
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

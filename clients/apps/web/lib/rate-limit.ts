import { createHash } from 'node:crypto'
import { type RateLimitPolicy, SCREENSHOT_RATE_LIMIT } from './api/rate-limit-policy'
import { getRedisClient } from './redis'

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return { count, redis.call('PTTL', KEYS[1]) }
`

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
}

function getRateLimitKey(identifier: string, policy: RateLimitPolicy): string {
  const hash = createHash('sha256').update(identifier).digest('hex')
  return `screenshot-studio:rate-limit:${policy.name}:${hash}`
}

function parseCounterResponse(response: unknown): [number, number] {
  if (
    !Array.isArray(response) ||
    response.length !== 2 ||
    !response.every((value) => typeof value === 'number')
  ) {
    throw new Error('Redis rate-limit script returned an invalid response.')
  }

  return [response[0], response[1]]
}

export async function checkRateLimit(
  identifier: string,
  policy: RateLimitPolicy = SCREENSHOT_RATE_LIMIT
): Promise<RateLimitResult> {
  const redis = await getRedisClient()
  const response = await redis.eval(RATE_LIMIT_SCRIPT, {
    arguments: [String(policy.windowMs)],
    keys: [getRateLimitKey(identifier, policy)],
  })
  const [count, ttl] = parseCounterResponse(response)

  return {
    allowed: count <= policy.maxRequests,
    limit: policy.maxRequests,
    remaining: Math.max(0, policy.maxRequests - count),
    resetAt: Date.now() + Math.max(0, ttl),
  }
}

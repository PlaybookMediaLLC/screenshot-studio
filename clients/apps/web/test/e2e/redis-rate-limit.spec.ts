import { randomUUID } from 'node:crypto'
import { expect, test } from './framework'

test.use({ workspaceOptions: { plan: 'pro' } })

const requestCount = 25
const allowedRequests = 20

test('the Redis rate limit accepts twenty concurrent requests and returns retry metadata', async ({
  page,
}) => {
  // The screenshot API needs a paid workspace; the fixture gives it Pro.
  const identifier = `e2e-rate-limit-${randomUUID()}`
  const responses = await page.evaluate(
    async ({ count, forwardedFor }) => {
      return Promise.all(
        Array.from({ length: count }, async () => {
          const response = await fetch('/api/screenshot', {
            body: JSON.stringify({ url: 'not-a-url' }),
            headers: {
              'content-type': 'application/json',
              'x-forwarded-for': forwardedFor,
            },
            method: 'POST',
          })
          return { retryAfter: response.headers.get('retry-after'), status: response.status }
        })
      )
    },
    { count: requestCount, forwardedFor: identifier }
  )

  expect(responses.filter((response) => response.status === 400)).toHaveLength(allowedRequests)
  expect(responses.filter((response) => response.status === 429)).toHaveLength(
    requestCount - allowedRequests
  )
  expect(responses.find((response) => response.status === 429)?.retryAfter).toMatch(/^\d+$/)
})

import { randomUUID } from 'node:crypto'
import { configureE2EFlow, expect, test } from './framework/flow'

const requestCount = 25
const allowedRequests = 20

configureE2EFlow()

test('the Redis rate limit accepts twenty concurrent requests and returns retry metadata', async ({
  app,
  page,
}) => {
  await app.open('/sign-in')
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

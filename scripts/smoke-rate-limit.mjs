import { randomUUID } from 'node:crypto'

const baseUrl = process.env.SCREENSHOT_STUDIO_URL ?? 'http://127.0.0.1:3000'
const identifier = `rate-limit-smoke-${randomUUID()}`
const maxAllowedRequests = 20

async function request() {
  const response = await fetch(`${baseUrl}/api/screenshot`, {
    body: JSON.stringify({ url: 'invalid-url' }),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': identifier,
    },
    method: 'POST',
  })
  return response.status
}

try {
  const statuses = []

  for (let index = 0; index <= maxAllowedRequests; index += 1) {
    statuses.push(await request())
  }

  const allowed = statuses.filter((status) => status === 400).length
  const blockedStatus = statuses.at(-1)

  if (allowed !== maxAllowedRequests || blockedStatus !== 429) {
    throw new Error(`Unexpected rate-limit statuses: ${statuses.join(',')}`)
  }

  console.log('Redis rate-limit smoke test passed.')
} catch (error) {
  console.error(error)
  process.exitCode = 1
}

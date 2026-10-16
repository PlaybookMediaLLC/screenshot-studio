import { randomUUID } from 'node:crypto'

const baseUrl = process.env.SCREENSHOT_STUDIO_URL ?? 'http://127.0.0.1:3000'
const identifier = `rate-limit-smoke-${randomUUID()}`
const maxAllowedRequests = 20

// The screenshot API needs a paid workspace, so the smoke signs in as the local
// dev account, which `bin/studio` gives a Pro plan.
async function signIn() {
  const password = process.env.STUDIO_DEV_PASSWORD
  if (!password) throw new Error('STUDIO_DEV_PASSWORD is not set; run bin/studio up first.')
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email: 'dev@localhost.test', password }),
    headers: {
      'content-type': 'application/json',
      origin: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    },
    method: 'POST',
  })
  if (!response.ok) throw new Error(`Dev sign-in failed with ${response.status}.`)
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

async function request(cookie) {
  const response = await fetch(`${baseUrl}/api/screenshot`, {
    body: JSON.stringify({ url: 'invalid-url' }),
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-forwarded-for': identifier,
    },
    method: 'POST',
  })
  return response.status
}

try {
  const cookie = await signIn()
  const statuses = []

  for (let index = 0; index <= maxAllowedRequests; index += 1) {
    statuses.push(await request(cookie))
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

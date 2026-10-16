import { randomUUID } from 'node:crypto'
import pg from 'pg'

const baseUrl = process.env.SCREENSHOT_STUDIO_URL ?? 'http://localhost:3000'
const identifier = `rate-limit-smoke-${randomUUID()}`
const maxAllowedRequests = 20

function cookiesFrom(response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

async function post(path, body, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      origin: baseUrl,
      ...(cookie ? { cookie } : {}),
    },
    method: 'POST',
  })
  if (!response.ok) throw new Error(`${path} returned ${response.status}.`)
  return response
}

// There is no free plan, so the smoke creates its own account and workspace
// and gives it Pro in the local database, the way the tenant-isolation check does.
async function paidSession() {
  const run = randomUUID().slice(0, 8)
  const email = `rate-limit-${run}@example.invalid`
  const password = `smoke-${randomUUID()}`
  await post('/api/auth/sign-up/email', { email, name: 'Rate limit smoke', password })
  let cookie = cookiesFrom(await post('/api/auth/sign-in/email', { email, password }))
  const created = await post(
    '/api/auth/organization/create',
    { name: `Rate limit ${run}`, slug: `rate-limit-${run}` },
    cookie
  )
  const { id: organizationId } = await created.json()
  const active = await post('/api/auth/organization/set-active', { organizationId }, cookie)
  cookie = [cookie, cookiesFrom(active)].filter(Boolean).join('; ')

  const connection = process.env.HOST_DATABASE_URL
  if (!connection)
    throw new Error('HOST_DATABASE_URL is required to give the smoke workspace a plan.')
  const url = new URL(connection)
  url.searchParams.delete('schema')
  const database = new pg.Pool({ connectionString: url.toString() })
  try {
    await database.query(
      `INSERT INTO workspace_entitlement ("organizationId", plan, status, "updatedAt")
       VALUES ($1, 'pro', 'active', now())
       ON CONFLICT ("organizationId") DO UPDATE SET plan = 'pro', status = 'active', "updatedAt" = now()`,
      [organizationId]
    )
  } finally {
    await database.end()
  }
  return cookie
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
  const cookie = await paidSession()
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

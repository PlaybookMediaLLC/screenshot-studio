import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, writeFile } from 'node:fs/promises'

const base = process.env.POSTIZ_SOCIAL_GATE_URL ?? 'http://127.0.0.1:3110'
const output = process.argv[2]
if (!output) throw new Error('Usage: node e2e/fixtures/bootstrap-go.mjs <private-output-file>')

async function json(path, options = {}) {
  const response = await fetch(new URL(path, base), options)
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return { body: await response.json(), response }
}

const suffix = randomUUID()
const { response: registered } = await json('/auth/register', {
  body: JSON.stringify({
    company: `Social gate ${suffix}`,
    email: `social-gate-${suffix}@example.test`,
    password: randomBytes(24).toString('base64url'),
    provider: 'LOCAL',
  }),
  headers: { 'Content-Type': 'application/json' },
  method: 'POST',
})
const cookie = registered.headers.getSetCookie().find((value) => value.startsWith('auth='))
if (!cookie) throw new Error('Go registration returned no auth cookie')
const { body: self } = await json('/user/self', { headers: { Cookie: cookie.split(';')[0] } })
const apiKey = self.publicApi
if (typeof apiKey !== 'string' || !apiKey) throw new Error('Go organization has no public API key')

const auth = { Authorization: apiKey }
const { body: me } = await json('/public/v1/me', { headers: auth })
async function connect(code) {
  const { body: start } = await json('/public/v1/social/e2e', { headers: auth })
  const state = new URL(start.url).searchParams.get('state')
  if (!state) throw new Error('Fake provider returned no OAuth state')
  const { body: connected } = await json('/integrations/social-connect/e2e', {
    body: JSON.stringify({ code, state, timezone: '0' }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  if (typeof connected.id !== 'string' || !connected.id) {
    throw new Error('Go fake connection returned no destination ID')
  }
  return connected.id
}
const destinationId = await connect('valid')
const expiredDestinationId = await connect('expired')
const { body: destinations } = await json('/public/v1/integrations', { headers: auth })
if (!destinations.some((item) => item.id === destinationId && item.identifier === 'e2e')) {
  throw new Error('Go fake destination is absent from the public API')
}

await writeFile(
  output,
  JSON.stringify({
    apiKey,
    destinationId,
    expiredDestinationId,
    goOrganizationId: me.organization.id,
  }),
  { mode: 0o600 }
)
await chmod(output, 0o600)
process.stdout.write('Isolated Go organization and fake destination ready.\n')

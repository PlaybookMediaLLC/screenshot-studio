import assert from 'node:assert/strict'
import test, { afterEach, before } from 'node:test'

const ORIGINAL_SECRET = process.env.BETTER_AUTH_SECRET

before(() => {
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters-long'
  process.env.BETTER_AUTH_URL = 'https://shots.oppulence.io'
})

afterEach(() => {
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters-long'
})

const load = async () => import('@/lib/tenant/unsubscribe-token')

test('a token round-trips to the address and organization that signed it', async () => {
  const { createUnsubscribeToken, verifyUnsubscribeToken } = await load()

  const token = createUnsubscribeToken({ email: 'customer@example.com', organizationId: 'org_1' })
  assert.deepEqual(verifyUnsubscribeToken(token), {
    email: 'customer@example.com',
    organizationId: 'org_1',
  })
})

test('a tampered payload is rejected', async () => {
  const { createUnsubscribeToken, verifyUnsubscribeToken } = await load()

  const token = createUnsubscribeToken({ email: 'customer@example.com', organizationId: 'org_1' })
  const [, signature] = token.split('.')

  // The endpoint is unauthenticated, so an attacker who could swap the
  // address in the payload would be able to unsubscribe anyone.
  const forgedPayload = Buffer.from('org_1:victim@example.com').toString('base64url')
  assert.equal(verifyUnsubscribeToken(`${forgedPayload}.${signature}`), null)
})

test('a token signed with a different secret is rejected', async () => {
  const { createUnsubscribeToken } = await load()
  const token = createUnsubscribeToken({ email: 'customer@example.com', organizationId: 'org_1' })

  process.env.BETTER_AUTH_SECRET = 'a-completely-different-secret-value-for-tests'
  const { verifyUnsubscribeToken } = await import(
    `@/lib/tenant/unsubscribe-token?secret=${Date.now()}`
  )

  assert.equal(verifyUnsubscribeToken(token), null)
})

test('malformed tokens are rejected rather than throwing', async () => {
  const { verifyUnsubscribeToken } = await load()

  // These arrive from the open internet, so none may crash the endpoint.
  for (const malformed of ['', '.', 'no-separator', 'a.b.c', '!!!.!!!']) {
    assert.equal(verifyUnsubscribeToken(malformed), null)
  }
})

test('addresses containing a colon survive the round trip', async () => {
  const { createUnsubscribeToken, verifyUnsubscribeToken } = await load()

  // The payload is organization:email, so splitting on the last colon
  // rather than the first would corrupt unusual but legal addresses.
  const email = 'odd:address@example.com'
  const token = createUnsubscribeToken({ email, organizationId: 'org_1' })
  assert.deepEqual(verifyUnsubscribeToken(token), { email, organizationId: 'org_1' })
})

test('an empty address or organization is rejected', async () => {
  const { verifyUnsubscribeToken } = await load()

  // A payload with an empty half would unsubscribe nothing while
  // reporting success, hiding a broken link from the recipient.
  for (const payload of [':customer@example.com', 'org_1:', ':']) {
    const encoded = Buffer.from(payload).toString('base64url')
    const { createUnsubscribeToken } = await load()
    const signed = createUnsubscribeToken({ email: 'x', organizationId: 'y' })
    const signature = signed.split('.')[1]
    assert.equal(verifyUnsubscribeToken(`${encoded}.${signature}`), null)
  }
})

test.after(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.BETTER_AUTH_SECRET
    return
  }
  process.env.BETTER_AUTH_SECRET = ORIGINAL_SECRET
})

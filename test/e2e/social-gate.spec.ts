import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect } from '@playwright/test'
import { z } from 'zod'
import { configureE2EFlow, test } from './framework/flow'
import {
  connectionSchema,
  createApprovedVariant,
  createPublishingWorkspace,
  createScheduledPost,
  enablePublishingTwoFactor,
  getActiveOrganizationId,
  png,
  trpcMutation,
} from './framework/publishing'
import { createE2EDatabase, queryRow, queryRows } from './framework/services'

const secretReference = 'SOCIAL_API_KEY_GATE'
const fakeURL = process.env.E2E_SOCIAL_GATE_FAKE_URL ?? 'http://127.0.0.1:5680'

const fakeStateSchema = z.object({
  posts: z.array(
    z.object({
      caption: z.string(),
      id: z.string(),
      media: z.array(
        z.object({
          bytes: z.number(),
          contentType: z.string(),
          expires: z.string(),
          sha256: z.string(),
          signedAt: z.string(),
        })
      ),
    })
  ),
  requests: z.number(),
})

async function fakeState() {
  return fakeStateSchema.parse(await (await fetch(`${fakeURL}/state`)).json())
}

async function resetFake(mode: 'normal' | 'throttle-once' | 'server-error-once'): Promise<void> {
  const response = await fetch(`${fakeURL}/control`, {
    body: JSON.stringify({ mode }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  expect(response.status).toBe(200)
}

/** Due soon enough for the Temporal timer to fire inside the test. */
function soon(): Date {
  return new Date(Date.now() + 15_000)
}

configureE2EFlow()

// bin/social-gate starts an isolated Go social stack and points the backend
// and worker at it; outside that script there is nothing to publish to.
test.skip(!process.env.E2E_SOCIAL_GATE_BOOTSTRAP, 'Run through bin/social-gate.')

test('the backend worker publishes once through Go, retries, honors cancellation, and fails closed', async ({
  identity,
  page,
}) => {
  test.setTimeout(15 * 60_000)
  const bootstrap = z
    .object({
      destinationId: z.string().min(1),
      expiredDestinationId: z.string().min(1),
      goOrganizationId: z.string().min(1),
    })
    .parse(JSON.parse(await readFile(process.env.E2E_SOCIAL_GATE_BOOTSTRAP!, 'utf8')))
  await resetFake('normal')
  await createPublishingWorkspace(identity, page)
  await enablePublishingTwoFactor(page, identity.password)
  const organizationId = await getActiveOrganizationId(page)
  const database = createE2EDatabase()
  const statusOf = async (id: string) =>
    (
      await queryRow<{ status: string }>(
        database,
        'SELECT status FROM scheduled_post WHERE id = $1',
        [id]
      )
    )?.status
  const awaitStatus = (id: string, status: string) =>
    expect.poll(() => statusOf(id), { intervals: [1_000], timeout: 180_000 }).toBe(status)
  const attemptsOf = (id: string) =>
    queryRows<{ outcome: string | null; providerPostId: string | null }>(
      database,
      'SELECT outcome, "providerPostId" FROM publication_attempt WHERE "scheduledPostId" = $1',
      [id]
    )
  try {
    await database.query('DELETE FROM social_tenant_binding WHERE "secretReference" = $1', [
      secretReference,
    ])
    await database.query(
      `INSERT INTO social_tenant_binding ("organizationId", "goOrganizationId", "secretReference")
       VALUES ($1, $2, $3)`,
      [organizationId, bootstrap.goOrganizationId, secretReference]
    )
    const variantId = await createApprovedVariant(page)
    const connect = async (externalAccountId: string) => {
      const response = await trpcMutation(page, 'channelConnection.create', {
        externalAccountId,
        platform: 'e2e',
        secretReference,
      })
      expect(response.status, JSON.stringify(response.body)).toBe(200)
      return connectionSchema.parse(response.body).connection.id
    }
    const connectionId = await connect(bootstrap.destinationId)

    // One canonical post, even when the request is repeated.
    const first = await createScheduledPost(
      page,
      connectionId,
      'social-gate-success',
      variantId,
      soon()
    )
    expect(first.response.status, JSON.stringify(first.response.body)).toBe(200)
    expect(first.scheduledPost.status).toBe('SCHEDULED')
    const duplicate = await createScheduledPost(
      page,
      connectionId,
      'social-gate-success',
      variantId
    )
    expect(duplicate.scheduledPost.id).toBe(first.scheduledPost.id)
    expect((await fakeState()).requests).toBe(0)

    await expect.poll(async () => (await fakeState()).posts.length, { timeout: 180_000 }).toBe(1)
    await awaitStatus(first.scheduledPost.id, 'PUBLISHED')
    const remote = await fakeState()
    expect(remote.requests).toBe(1)
    expect(remote.posts[0]).toMatchObject({
      caption: 'The launch is ready.',
      media: [
        {
          bytes: png.length,
          contentType: 'image/png',
          expires: '86400',
          sha256: createHash('sha256').update(png).digest('hex'),
        },
      ],
    })
    const [attempt, ...extraAttempts] = await attemptsOf(first.scheduledPost.id)
    expect(extraAttempts).toHaveLength(0)
    expect(attempt?.outcome).toBe('SUCCEEDED')
    expect(attempt?.providerPostId).toBe(remote.posts[0]?.id)
    expect(remote.posts[0]?.media[0]?.signedAt).toMatch(/^\d{8}T\d{6}Z$/)
    expect(
      await queryRow<{ count: string }>(
        database,
        'SELECT count(*)::text AS count FROM "Post" WHERE "organizationId" = $1',
        [bootstrap.goOrganizationId]
      )
    ).toEqual({ count: '0' })

    // A cancelled post never reaches the destination after its due time.
    const cancelled = await createScheduledPost(
      page,
      connectionId,
      'social-gate-cancelled',
      variantId,
      soon()
    )
    expect(
      await trpcMutation(page, 'scheduledPost.cancel', {
        scheduledPostId: cancelled.scheduledPost.id,
      })
    ).toMatchObject({ body: { scheduledPost: { status: 'CANCELLED' } }, status: 200 })
    await page.waitForTimeout(30_000)
    expect(await statusOf(cancelled.scheduledPost.id)).toBe('CANCELLED')
    expect((await fakeState()).requests).toBe(1)
    const actions = await queryRows<{ action: string }>(
      database,
      `SELECT action FROM audit_log WHERE "organizationId" = $1 AND action LIKE 'post.%'`,
      [organizationId]
    )
    expect(new Set(actions.map((row) => row.action))).toEqual(
      new Set(['post.connection_created', 'post.scheduled', 'post.cancelled', 'post.published'])
    )

    // A throttled or failing provider is retried into exactly one remote post.
    for (const mode of ['throttle-once', 'server-error-once'] as const) {
      await resetFake(mode)
      const retry = await createScheduledPost(
        page,
        connectionId,
        `social-gate-${mode}`,
        variantId,
        soon()
      )
      await expect.poll(async () => (await fakeState()).posts.length, { timeout: 180_000 }).toBe(1)
      await awaitStatus(retry.scheduledPost.id, 'PUBLISHED')
      const retried = await fakeState()
      expect(retried.requests).toBe(2)
      expect(retried.posts).toHaveLength(1)
      expect(
        (await attemptsOf(retry.scheduledPost.id)).filter((item) => item.outcome === 'SUCCEEDED')
      ).toHaveLength(1)
    }

    // An expired provider credential fails the post without publishing.
    await resetFake('normal')
    const expiredConnectionId = await connect(bootstrap.expiredDestinationId)
    const expired = await createScheduledPost(
      page,
      expiredConnectionId,
      'social-gate-expired',
      variantId,
      soon()
    )
    await awaitStatus(expired.scheduledPost.id, 'FAILED')
    expect((await fakeState()).posts).toHaveLength(0)
    expect(
      (await attemptsOf(expired.scheduledPost.id)).some((item) => item.outcome === 'FAILED')
    ).toBe(true)
  } finally {
    await database.query('DELETE FROM social_tenant_binding WHERE "organizationId" = $1', [
      organizationId,
    ])
    await database.end()
  }
})

import { createHmac, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { signUpAndCreateWorkspace } from './framework/auth'
import { browserRequest, requestJson } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'
import { createE2EDatabase, queryRows } from './framework/services'

const sourceSchema = z.object({ sourceApp: z.object({ id: z.string().min(1) }) })
const webhookResultSchema = z.object({ created: z.boolean(), releaseId: z.string().uuid() })
const releasesSchema = z.object({
  releases: z.array(z.object({ id: z.string().uuid(), title: z.string() })),
})

function getWebhookSignature(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

function getWebhookSecret(): string {
  const secret = process.env.E2E_WEBHOOK_SECRET
  if (!secret) {
    throw new Error('E2E_WEBHOOK_SECRET must be set by the local stack command.')
  }

  return secret
}

// Dispatch is the Go maintenance worker's job; ingestion only queues the event.
async function getIngestOutboxEvent(releaseId: string) {
  const database = createE2EDatabase()
  try {
    return await queryRows(
      database,
      `SELECT * FROM outbox_event WHERE "aggregateId" = $1 AND type = 'release.ingested'`,
      [releaseId]
    )
  } finally {
    await database.end()
  }
}

async function setSourceStatus(sourceAppId: string, status: 'DRAFT'): Promise<void> {
  const database = createE2EDatabase()
  try {
    await database.query('UPDATE source_app SET status = $1, "updatedAt" = now() WHERE id = $2', [
      status,
      sourceAppId,
    ])
  } finally {
    await database.end()
  }
}

configureE2EFlow()

test('a signed webhook creates one release and rejects invalid replays', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const source = sourceSchema.parse(
    (
      await requestJson(page, '/api/tenant/source-apps', {
        allowedHosts: ['https://api.github.com'],
        name: 'E2E GitHub',
        provider: 'github',
        secretReference: 'CLEANUP_SECRET',
      })
    ).body
  ).sourceApp
  const body = JSON.stringify({
    release: { body: 'Reliable content automation.', name: 'Webhook release' },
  })
  const delivery = randomUUID()
  const headers = {
    'content-type': 'application/json',
    'x-github-delivery': delivery,
    'x-github-event': 'release',
    'x-hub-signature-256': getWebhookSignature(body, getWebhookSecret()),
  }

  const first = await browserRequest(page, `/api/webhooks/source/${source.id}`, {
    body,
    headers,
    method: 'POST',
  })
  const duplicate = await browserRequest(page, `/api/webhooks/source/${source.id}`, {
    body,
    headers,
    method: 'POST',
  })
  const invalid = await browserRequest(page, `/api/webhooks/source/${source.id}`, {
    body,
    headers: {
      ...headers,
      'x-github-delivery': randomUUID(),
      'x-hub-signature-256': 'sha256=invalid',
    },
    method: 'POST',
  })
  const firstResult = webhookResultSchema.parse(first.body)
  const duplicateResult = webhookResultSchema.parse(duplicate.body)
  const releases = releasesSchema.parse((await browserRequest(page, '/api/tenant/releases')).body)

  expect(first.status).toBe(201)
  expect(duplicate.status).toBe(200)
  expect(duplicateResult).toEqual({ created: false, releaseId: firstResult.releaseId })
  expect(invalid.status).toBe(401)
  expect(releases.releases).toContainEqual(
    expect.objectContaining({ id: firstResult.releaseId, title: 'Webhook release' })
  )
  await expect(getIngestOutboxEvent(firstResult.releaseId)).resolves.toMatchObject([
    {
      deliveredAt: null,
      payload: { releaseId: firstResult.releaseId, sourceAppId: source.id },
    },
  ])
})

test('a generic source rejects stale events and stops ingesting when disabled', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const source = sourceSchema.parse(
    (
      await requestJson(page, '/api/tenant/source-apps', {
        allowedHosts: ['https://releases.example.test'],
        name: 'E2E generic source',
        provider: 'generic',
        secretReference: 'CLEANUP_SECRET',
      })
    ).body
  ).sourceApp
  const body = JSON.stringify({
    benefitStatement: 'A generic release event.',
    title: 'Generic webhook release',
  })
  const signedHeaders = (timestamp: string) => ({
    'content-type': 'application/json',
    'x-screenshot-studio-event-id': randomUUID(),
    'x-screenshot-studio-signature': getWebhookSignature(body, getWebhookSecret()),
    'x-screenshot-studio-timestamp': timestamp,
  })

  const accepted = await browserRequest(page, `/api/webhooks/source/${source.id}`, {
    body,
    headers: signedHeaders(new Date().toISOString()),
    method: 'POST',
  })
  const stale = await browserRequest(page, `/api/webhooks/source/${source.id}`, {
    body,
    headers: signedHeaders(new Date(Date.now() - 6 * 60 * 1_000).toISOString()),
    method: 'POST',
  })
  await setSourceStatus(source.id, 'DRAFT')
  const disabled = await browserRequest(page, `/api/webhooks/source/${source.id}`, {
    body,
    headers: signedHeaders(new Date().toISOString()),
    method: 'POST',
  })

  expect(accepted.status).toBe(201)
  expect(stale.status).toBe(401)
  expect(disabled.status).toBe(401)
})

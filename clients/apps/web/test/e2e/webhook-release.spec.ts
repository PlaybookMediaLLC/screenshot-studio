import { createHmac, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  browserRequest,
  createWorkspace,
  db,
  expect,
  openWorkspaceSetting,
  requestJson,
  test,
  trpcMutation,
} from './framework'

test.use({ workspaceOptions: { plan: 'pro' } })

const sourceSchema = z.object({ sourceApp: z.object({ id: z.string().min(1) }) })
const apiKeySchema = z.object({ apiKey: z.object({ key: z.string().min(1) }) })
const webhookResultSchema = z.object({ created: z.boolean(), releaseId: z.string().uuid() })
const changeResultSchema = z.object({ changeId: z.string().min(1), created: z.boolean() })
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
  return await db.rows(
    `SELECT * FROM outbox_event WHERE "aggregateId" = $1 AND type = 'release.ingested'`,
    [releaseId]
  )
}

async function setSourceStatus(sourceAppId: string, status: 'DRAFT'): Promise<void> {
  await db.query('UPDATE source_app SET status = $1, "updatedAt" = now() WHERE id = $2', [
    status,
    sourceAppId,
  ])
}

test('a signed webhook creates one release and rejects invalid replays', async ({ page }) => {
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
    action: 'published',
    release: { body: 'Reliable content automation.', id: 1, name: 'Webhook release' },
    repository: { id: 1 },
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

test('a GitHub source holds merges into its branch for the next release and ignores the rest', async ({
  page,
}) => {
  const fullRef = await requestJson(page, '/api/tenant/source-apps', {
    allowedHosts: ['https://api.github.com'],
    branch: 'refs/heads/release',
    name: 'E2E GitHub full ref',
    provider: 'github',
    secretReference: 'CLEANUP_SECRET',
  })
  expect(fullRef.status).toBe(400)
  const source = sourceSchema.parse(
    (
      await requestJson(page, '/api/tenant/source-apps', {
        allowedHosts: ['https://api.github.com'],
        branch: 'release',
        name: 'E2E GitHub merges',
        provider: 'github',
        secretReference: 'CLEANUP_SECRET',
      })
    ).body
  ).sourceApp
  const deliver = (event: string, payload: unknown) => {
    const body = JSON.stringify(payload)
    return browserRequest(page, `/api/webhooks/source/${source.id}`, {
      body,
      headers: {
        'content-type': 'application/json',
        'x-github-delivery': randomUUID(),
        'x-github-event': event,
        'x-hub-signature-256': getWebhookSignature(body, getWebhookSecret()),
      },
      method: 'POST',
    })
  }
  const pullRequest = (base: string, merged: boolean, number = 452, login = 'octocat') => ({
    action: 'closed',
    pull_request: {
      base: { ref: base },
      body: 'Invoices repeat on a schedule.',
      html_url: `https://github.com/acme/app/pull/${number}`,
      merged,
      number,
      title: number === 452 ? 'Add recurring invoices' : `Merged change ${number}`,
      user: { login, type: login.endsWith('[bot]') ? 'Bot' : 'User' },
    },
    repository: { default_branch: 'main', id: 123 },
  })
  const release = (id: number, prerelease: boolean) => ({
    action: 'published',
    release: { body: 'Notes.', id, name: `v${id}`, prerelease, tag_name: `v${id}` },
    repository: { id: 123 },
  })
  const updateRules = (rules: unknown, id = source.id) =>
    browserRequest(page, `/api/tenant/source-apps/${id}`, {
      body: JSON.stringify(rules),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    })

  const ping = await deliver('ping', { zen: 'Keep it logically awesome.' })
  const offBranch = await deliver('pull_request', pullRequest('main', true))
  const unmerged = await deliver('pull_request', pullRequest('release', false))
  const merged = await deliver('pull_request', pullRequest('release', true))
  const redelivered = await deliver('pull_request', pullRequest('release', true))
  const mergedResult = changeResultSchema.parse(merged.body)
  const releases = releasesSchema.parse((await browserRequest(page, '/api/tenant/releases')).body)

  expect([ping.status, offBranch.status, unmerged.status]).toEqual([202, 202, 202])
  expect(merged.status).toBe(201)
  expect(redelivered.status).toBe(200)
  expect(changeResultSchema.parse(redelivered.body)).toEqual({
    changeId: mergedResult.changeId,
    created: false,
  })
  // A merge is held for the next release, not announced on its own.
  expect(releases.releases.some((release) => release.title === 'Add recurring invoices')).toBe(
    false
  )

  // Bot pull requests are ignored until the source keeps them.
  const dependabot = pullRequest('release', true, 453, 'dependabot[bot]')
  expect((await deliver('pull_request', dependabot)).status).toBe(202)
  const keepBots = await updateRules({ ignoreBotPullRequests: false })
  expect(keepBots.status).toBe(200)
  expect(keepBots.body).toMatchObject({
    sourceApp: { branch: 'release', ignoreBotPullRequests: false },
  })
  expect((await deliver('pull_request', dependabot)).status).toBe(201)
  // A listed author is ignored even with bots kept, and only that author.
  await updateRules({ ignoredPullRequestAuthors: ['Dependabot[bot]'] })
  expect(
    (await deliver('pull_request', pullRequest('release', true, 454, 'dependabot[bot]'))).status
  ).toBe(202)
  expect(
    (await deliver('pull_request', pullRequest('release', true, 455, 'renovate[bot]'))).status
  ).toBe(201)
  // The next release takes every held merge as a feature; the ignored author's is absent.
  const first = await deliver('release', release(1, true))
  expect(first.status).toBe(201)
  const [stored] = await db.rows<{ features: Array<{ number?: number; title: string }> }>(
    'SELECT features FROM release WHERE id = $1',
    [webhookResultSchema.parse(first.body).releaseId]
  )
  expect(stored.features.map((feature) => feature.number).sort()).toEqual([452, 453, 455])
  expect(stored.features).toContainEqual(
    expect.objectContaining({ number: 452, title: 'Add recurring invoices' })
  )
  // Pre-releases are kept until the source skips them.
  await updateRules({ skipPrereleases: true })
  expect((await deliver('release', release(2, true))).status).toBe(202)
  expect((await deliver('release', release(3, false))).status).toBe(201)
  // A null branch follows the repository's default branch again.
  const followDefault = await updateRules({ branch: null })
  expect(followDefault.body).toMatchObject({ sourceApp: { branch: null, skipPrereleases: true } })
  expect((await deliver('pull_request', pullRequest('main', true, 456))).status).toBe(201)
  expect((await deliver('pull_request', pullRequest('release', true, 457))).status).toBe(202)

  expect((await updateRules({})).status).toBe(400)
  expect((await updateRules({ branch: 'refs/heads/main' })).status).toBe(400)
  expect((await updateRules({ ignoredPullRequestAuthors: ['not a login'] })).status).toBe(400)
  expect((await updateRules({ skipPrereleases: false }, 'unknownsource01')).status).toBe(404)
})

test('only the owning workspace, with source:write, can change a source’s rules', async ({
  browser,
  identity,
  page,
}) => {
  const source = sourceSchema.parse(
    (
      await requestJson(page, '/api/tenant/source-apps', {
        allowedHosts: ['https://api.github.com'],
        name: 'E2E GitHub rules',
        provider: 'github',
        secretReference: 'CLEANUP_SECRET',
      })
    ).body
  ).sourceApp
  const keyWith = async (scopes: string[]) =>
    apiKeySchema.parse(
      (await trpcMutation(page, 'apiKey.create', { name: scopes[0], scopes })).body
    ).apiKey.key
  const patch = (target: typeof page, rules: unknown, headers: Record<string, string> = {}) =>
    browserRequest(target, `/api/v1/source-apps/${source.id}`, {
      body: JSON.stringify(rules),
      headers: { 'content-type': 'application/json', ...headers },
      method: 'PATCH',
    })
  const writer = await keyWith(['source:write'])
  const reader = await keyWith(['artifact:read'])

  const byKey = await patch(page, { skipPrereleases: true }, { 'x-api-key': writer })
  expect(byKey.status).toBe(200)
  expect(byKey.body).toMatchObject({
    sourceApp: {
      ignoreBotPullRequests: true,
      ignoredPullRequestAuthors: [],
      skipPrereleases: true,
    },
  })
  expect((await patch(page, { skipPrereleases: false }, { 'x-api-key': reader })).status).toBe(403)

  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()
  try {
    await createWorkspace(
      {
        ...identity,
        email: `other-${identity.email}`,
        workspaceName: `Other ${identity.workspaceName}`,
      },
      otherPage
    )
    // Another workspace cannot tell the source exists, let alone change it.
    expect((await patch(otherPage, { skipPrereleases: false })).status).toBe(404)
  } finally {
    await otherContext.close()
  }
  const after = await patch(page, { ignoreBotPullRequests: true })
  expect(after.body).toMatchObject({ sourceApp: { skipPrereleases: true } })
})

test('a GitHub source set up in Developer API settings shows a working URL and secret once', async ({
  page,
}) => {
  await openWorkspaceSetting(page, 'Developer API')
  await page.getByLabel('Source name').fill('UI GitHub source')
  await page.getByLabel('Branch', { exact: true }).fill('release')
  await page.getByLabel('Allowed host').fill('https://api.github.com')
  await page.getByRole('button', { name: 'Add source' }).click()
  const url = new URL(await page.getByLabel('Payload URL', { exact: true }).inputValue())
  const secret = await page.getByLabel('Secret', { exact: true }).inputValue()
  expect(url.pathname).toMatch(/^\/api\/webhooks\/source\/[a-z0-9]+$/)
  expect(secret).toMatch(/^whsec_/)

  const deliver = (base: string, signingSecret = secret) => {
    const body = JSON.stringify({
      action: 'closed',
      pull_request: {
        base: { ref: base },
        body: 'Set up from the settings page.',
        html_url: `https://github.com/acme/app/pull/${base.length}`,
        merged: true,
        number: base.length,
        title: `Merged into ${base}`,
        user: { login: 'octocat', type: 'User' },
      },
      repository: { default_branch: 'main', id: 321 },
    })
    return browserRequest(page, url.pathname, {
      body,
      headers: {
        'content-type': 'application/json',
        'x-github-delivery': randomUUID(),
        'x-github-event': 'pull_request',
        'x-hub-signature-256': getWebhookSignature(body, signingSecret),
      },
      method: 'POST',
    })
  }
  expect((await deliver('release')).status).toBe(201)
  expect((await deliver('main')).status).toBe(202)
  expect((await deliver('release', `${secret}x`)).status).toBe(401)

  // Shown once: dismissed, the secret is gone from the page.
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByLabel('Secret', { exact: true })).toHaveCount(0)

  // The API returns the same setup; an operator-managed secret is never revealed.
  const derived = await requestJson(page, '/api/tenant/source-apps', {
    allowedHosts: ['https://api.github.com'],
    name: 'API GitHub source',
    provider: 'github',
  })
  expect(derived.body).toMatchObject({
    webhook: {
      secret: expect.stringMatching(/^whsec_/),
      url: expect.stringContaining('/api/webhooks/source/'),
    },
  })
  const managed = await requestJson(page, '/api/tenant/source-apps', {
    allowedHosts: ['https://api.github.com'],
    name: 'Operator GitHub source',
    provider: 'github',
    secretReference: 'CLEANUP_SECRET',
  })
  expect(managed.body).toMatchObject({ webhook: { secret: null } })
  const gitlab = await requestJson(page, '/api/tenant/source-apps', {
    allowedHosts: ['https://gitlab.com'],
    name: 'GitLab source',
    provider: 'gitlab',
  })
  expect(gitlab.body).toMatchObject({ webhook: { secret: null } })
})

test('a generic source rejects stale events and stops ingesting when disabled', async ({
  page,
}) => {
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
  // The signature binds the event ID and timestamp to the body.
  const signedHeaders = (timestamp: string, eventId: string = randomUUID()) => ({
    'content-type': 'application/json',
    'x-shots-event-id': eventId,
    'x-shots-signature': `v1=${createHmac('sha256', getWebhookSecret())
      .update(`${eventId}.${timestamp}.${body}`)
      .digest('hex')}`,
    'x-shots-timestamp': timestamp,
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
  // A captured request: the same ID is a duplicate, and a new ID or time breaks the signature.
  const captured = signedHeaders(new Date().toISOString())
  const send = (headers: Record<string, string>) =>
    browserRequest(page, `/api/webhooks/source/${source.id}`, { body, headers, method: 'POST' })
  const original = await send(captured)
  const replayed = await send(captured)
  const newId = await send({ ...captured, 'x-shots-event-id': randomUUID() })
  const newTime = await send({
    ...captured,
    'x-shots-timestamp': new Date(Date.now() + 1_000).toISOString(),
  })
  const bodyOnly = await send({
    ...captured,
    'x-shots-signature': getWebhookSignature(body, getWebhookSecret()),
  })
  const githubStyle = await send({
    'content-type': 'application/json',
    'x-github-delivery': randomUUID(),
    'x-hub-signature-256': getWebhookSignature(body, getWebhookSecret()),
  })
  await setSourceStatus(source.id, 'DRAFT')
  const disabled = await browserRequest(page, `/api/webhooks/source/${source.id}`, {
    body,
    headers: signedHeaders(new Date().toISOString()),
    method: 'POST',
  })

  expect(accepted.status).toBe(201)
  expect(stale.status).toBe(401)
  expect([original.status, replayed.status]).toEqual([201, 200])
  expect([newId.status, newTime.status, bodyOnly.status, githubStyle.status]).toEqual([
    401, 401, 401, 401,
  ])
  expect(disabled.status).toBe(401)
})

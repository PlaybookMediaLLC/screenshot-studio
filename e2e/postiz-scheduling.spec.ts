import { expect, type Page } from '@playwright/test'
import { getE2EUrl } from './framework/auth'
import { configureE2EFlow, test } from './framework/flow'
import { startHttpMockServer } from './framework/http-server'
import { createE2EDatabase, queryRow } from './framework/services'
import {
  connectionSchema,
  createApprovedVariant,
  createPublishingWorkspace,
  createScheduledPost,
  enablePublishingTwoFactor,
  getActiveOrganizationId,
  scheduledPostSchema,
  trpcMutation,
} from './framework/publishing'

const e2eSecretReference = 'POSTIZ_API_KEY_E2E'
async function bindTestGoOrganization(page: Page): Promise<string> {
  const organizationId = await getActiveOrganizationId(page)
  const goOrganizationId = `go-${organizationId}`
  const database = createE2EDatabase()
  try {
    await database.query('DELETE FROM postiz_tenant_binding WHERE "secretReference" = $1', [
      e2eSecretReference,
    ])
    await database.query(
      `INSERT INTO postiz_tenant_binding ("organizationId", "goOrganizationId", "secretReference")
       VALUES ($1, $2, $3)`,
      [organizationId, goOrganizationId, e2eSecretReference]
    )
  } finally {
    await database.end()
  }
  return organizationId
}

async function unbindTestGoOrganization(organizationId: string | null): Promise<void> {
  if (!organizationId) return
  const database = createE2EDatabase()
  try {
    await database.query(
      'DELETE FROM postiz_tenant_binding WHERE "organizationId" = $1 AND "secretReference" = $2',
      [organizationId, e2eSecretReference]
    )
  } finally {
    await database.end()
  }
}

async function expectOAuthConnection(
  organizationId: string | null,
  integrationId: string,
  state: string,
  platform: string
): Promise<void> {
  const database = createE2EDatabase()
  try {
    expect(
      await queryRow(
        database,
        `SELECT platform, "secretReference" FROM channel_connection
         WHERE "externalAccountId" = $1 AND "organizationId" = $2 LIMIT 1`,
        [integrationId, organizationId]
      )
    ).toEqual({ platform, secretReference: e2eSecretReference })
    expect(
      await queryRow(database, 'SELECT state FROM social_oauth_start WHERE state = $1', [state])
    ).toBeNull()
  } finally {
    await database.end()
  }
}

async function deleteOAuthStart(state: string): Promise<void> {
  const database = createE2EDatabase()
  try {
    await database.query('DELETE FROM social_oauth_start WHERE state = $1', [state])
  } finally {
    await database.end()
  }
}

configureE2EFlow()

// Dispatch, retries, revocation, and recovery run in the Go publishing worker
// (services/internal/temporalpublishing) and are covered by its tests. These
// flows cover what the web still owns: verified destinations, idempotent
// scheduling, cancellation, tenant isolation, and the OAuth callbacks.
test('an approved variant schedules once to a verified Go destination and can be cancelled', async ({
  identity,
  page,
}) => {
  let organizationId: string | null = null
  const provider = await startHttpMockServer((request) => {
    if (request.url === '/api/public/v1/me') {
      return { body: { organization: { id: `go-${organizationId}` } } }
    }
    if (request.url === '/api/public/v1/integrations') {
      return { body: [{ id: 'postiz-x-integration', identifier: 'x', disabled: false }] }
    }
    return { body: { error: 'Not found.' }, status: 404 }
  }, 5679)

  try {
    await createPublishingWorkspace(identity, page)
    await enablePublishingTwoFactor(page, identity.password)
    const variantId = await createApprovedVariant(page)
    const unbound = await trpcMutation(page, 'channelConnection.create', {
      externalAccountId: 'postiz-x-integration',
      platform: 'x',
      secretReference: e2eSecretReference,
    })
    expect(unbound.status).toBe(409)
    expect(provider.calls).toHaveLength(0)

    organizationId = await bindTestGoOrganization(page)
    const wrongCredential = await trpcMutation(page, 'channelConnection.create', {
      externalAccountId: 'postiz-x-integration',
      platform: 'x',
      secretReference: 'POSTIZ_API_KEY',
    })
    expect(wrongCredential.status).toBe(409)
    expect(provider.calls).toHaveLength(0)
    const foreignDestination = await trpcMutation(page, 'channelConnection.create', {
      externalAccountId: 'another-organizations-destination',
      platform: 'x',
      secretReference: e2eSecretReference,
    })
    expect(foreignDestination.status).toBe(404)
    expect(provider.calls.map((call) => call.url)).toEqual([
      '/api/public/v1/me',
      '/api/public/v1/integrations',
    ])
    const connectionResponse = await trpcMutation(page, 'channelConnection.create', {
      externalAccountId: 'postiz-x-integration',
      platform: 'x',
      providerSettings: { who_can_reply_post: 'everyone' },
      secretReference: e2eSecretReference,
    })
    expect(connectionResponse.status).toBe(200)
    const connectionId = connectionSchema.parse(connectionResponse.body).connection.id

    const first = await createScheduledPost(page, connectionId, 'postiz-launch', variantId)
    expect(first.response.status).toBe(200)
    expect(scheduledPostSchema.parse(first.response.body).created).toBe(true)
    const duplicate = await createScheduledPost(page, connectionId, 'postiz-launch', variantId)
    expect(duplicate.response.status).toBe(200)
    expect(scheduledPostSchema.parse(duplicate.response.body).created).toBe(false)
    expect(duplicate.scheduledPost.id).toBe(first.scheduledPost.id)

    const cancelResponse = await trpcMutation(page, 'scheduledPost.cancel', {
      scheduledPostId: first.scheduledPost.id,
    })
    expect(cancelResponse).toMatchObject({
      body: { scheduledPost: { status: 'CANCELLED' } },
      status: 200,
    })
  } finally {
    await provider.close()
    await unbindTestGoOrganization(organizationId)
  }
})

test('another workspace cannot attach or control a bound Go destination', async ({
  browser,
  identity,
  page,
}) => {
  let organizationId: string | null = null
  const backend = await startHttpMockServer(
    (request) =>
      request.url === '/api/public/v1/me'
        ? { body: { organization: { id: `go-${organizationId}` } } }
        : request.url === '/api/public/v1/integrations'
          ? { body: [{ id: 'tenant-a-destination', identifier: 'x', disabled: false }] }
          : { body: { error: 'Unexpected request.' }, status: 500 },
    5679
  )
  const secondContext = await browser.newContext()
  try {
    await createPublishingWorkspace(identity, page)
    await enablePublishingTwoFactor(page, identity.password)
    organizationId = await bindTestGoOrganization(page)
    const variantId = await createApprovedVariant(page)
    const connection = connectionSchema.parse(
      (
        await trpcMutation(page, 'channelConnection.create', {
          externalAccountId: 'tenant-a-destination',
          platform: 'x',
          secretReference: e2eSecretReference,
        })
      ).body
    ).connection
    const post = await createScheduledPost(page, connection.id, 'tenant-a-post', variantId)
    const providerCallCount = backend.calls.length

    const secondPage = await secondContext.newPage()
    const secondIdentity = {
      ...identity,
      email: `foreign-${identity.email}`,
      workspaceName: `Foreign ${identity.workspaceName}`,
    }
    await createPublishingWorkspace(secondIdentity, secondPage)
    await enablePublishingTwoFactor(secondPage, secondIdentity.password)
    expect(
      (
        await trpcMutation(secondPage, 'channelConnection.create', {
          externalAccountId: 'tenant-a-destination',
          platform: 'x',
          secretReference: e2eSecretReference,
        })
      ).status
    ).toBe(409)
    const foreignSchedule = await trpcMutation(secondPage, 'scheduledPost.create', {
      caption: 'A foreign post',
      channelConnectionId: connection.id,
      idempotencyKey: 'foreign-schedule',
      scheduledFor: new Date(Date.now() + 60_000).toISOString(),
      variantId,
    })
    expect(foreignSchedule.status, JSON.stringify(foreignSchedule.body)).toBe(404)
    expect(
      (
        await trpcMutation(secondPage, 'scheduledPost.cancel', {
          scheduledPostId: post.scheduledPost.id,
        })
      ).status
    ).toBe(404)
    expect(backend.calls).toHaveLength(providerCallCount)
  } finally {
    await secondContext.close()
    await unbindTestGoOrganization(organizationId)
    await backend.close()
  }
})

test('X OAuth start binds its one-use callback to the active workspace', async ({
  identity,
  page,
}) => {
  let organizationId: string | null = null
  const state = 'oauth-state-for-x'
  const integrationId = 'go-x-test-integration'
  const backend = await startHttpMockServer((request) => {
    if (request.url === '/api/public/v1/me') {
      return { body: { organization: { id: `go-${organizationId}` } } }
    }
    if (request.url === '/api/public/v1/social/x') {
      return {
        body: { url: `https://api.x.com/oauth/authenticate?oauth_token=${state}` },
      }
    }
    if (request.url === '/integrations/social-connect/x') {
      return { body: { id: integrationId, pages: [] } }
    }
    if (request.url === '/api/public/v1/integrations') {
      return { body: [{ id: integrationId, identifier: 'x', disabled: false }] }
    }
    return { body: { error: 'Not found.' }, status: 404 }
  }, 5679)

  try {
    await createPublishingWorkspace(identity, page)
    await enablePublishingTwoFactor(page, identity.password)
    organizationId = await bindTestGoOrganization(page)

    const start = await page
      .context()
      .request.get('http://localhost:3000/integrations/social/x/start', {
        maxRedirects: 0,
      })
    expect(start.status(), `${await start.text()} ${backend.calls.map((call) => call.url)}`).toBe(
      303
    )
    expect(start.headers().location).toBe(
      `https://api.x.com/oauth/authenticate?oauth_token=${state}`
    )

    await page.goto(`/integrations/social/x?oauth_token=${state}&oauth_verifier=test-verifier`)
    await expect(page.getByText('x connected to Shots.')).toBeVisible()

    await expectOAuthConnection(organizationId, integrationId, state, 'x')

    const callsBeforeReplay = backend.calls.length
    const replay = await page
      .context()
      .request.get(
        `http://localhost:3000/integrations/social/x?oauth_token=${state}&oauth_verifier=test-verifier`
      )
    expect(replay.status()).toBe(403)
    expect(backend.calls).toHaveLength(callsBeforeReplay)
  } finally {
    await deleteOAuthStart(state)
    await unbindTestGoOrganization(organizationId)
    await backend.close()
  }
})

test('LinkedIn OAuth callback connects through the SDK and rejects replay', async ({
  identity,
  page,
}) => {
  let organizationId: string | null = null
  const state = 'oauth-state-for-linkedin'
  const integrationId = 'go-linkedin-test-integration'
  const backend = await startHttpMockServer((request) => {
    if (request.url === '/api/public/v1/me') {
      return { body: { organization: { id: `go-${organizationId}` } } }
    }
    if (request.url === '/api/public/v1/social/linkedin') {
      return { body: { url: `https://www.linkedin.com/oauth/v2/authorization?state=${state}` } }
    }
    if (request.url === '/integrations/social-connect/linkedin') {
      return { body: { id: integrationId, pages: [] } }
    }
    if (request.url === '/api/public/v1/integrations') {
      return { body: [{ id: integrationId, identifier: 'linkedin', disabled: false }] }
    }
    return { body: { error: 'Not found.' }, status: 404 }
  }, 5679)
  try {
    await createPublishingWorkspace(identity, page)
    await enablePublishingTwoFactor(page, identity.password)
    organizationId = await bindTestGoOrganization(page)

    const start = await page
      .context()
      .request.get(getE2EUrl('/integrations/social/linkedin/start'), {
        maxRedirects: 0,
      })
    expect(start.status()).toBe(303)
    expect(start.headers().location).toBe(
      `https://www.linkedin.com/oauth/v2/authorization?state=${state}`
    )

    const callbackURL = getE2EUrl(`/integrations/social/linkedin?code=test-code&state=${state}`)
    const callback = await page.context().request.get(callbackURL)
    expect(callback.status(), await callback.text()).toBe(200)
    await expectOAuthConnection(organizationId, integrationId, state, 'linkedin')

    const callsBeforeReplay = backend.calls.length
    expect((await page.context().request.get(callbackURL)).status()).toBe(403)
    expect(backend.calls).toHaveLength(callsBeforeReplay)
  } finally {
    await deleteOAuthStart(state)
    await unbindTestGoOrganization(organizationId)
    await backend.close()
  }
})

test('Instagram with Facebook Login registers the selected Page once', async ({
  identity,
  page,
}) => {
  let organizationId: string | null = null
  const state = 'oauth-state-for-instagram'
  const integrationId = 'go-instagram-test-integration'
  const backend = await startHttpMockServer((request) => {
    if (request.url === '/api/public/v1/me') {
      return { body: { organization: { id: `go-${organizationId}` } } }
    }
    if (request.url === '/api/public/v1/social/instagram') {
      return {
        body: { url: `https://www.facebook.com/v24.0/dialog/oauth?state=${state}` },
      }
    }
    if (request.url === '/integrations/social-connect/instagram') {
      return {
        body: {
          id: integrationId,
          pages: [
            { id: 'instagram-test-account', name: 'Test Page', pageId: 'facebook-test-page' },
          ],
        },
      }
    }
    if (request.url === `/integrations/public/provider/${integrationId}/connect`) {
      return { body: { success: true } }
    }
    if (request.url === '/api/public/v1/integrations') {
      return { body: [{ id: integrationId, identifier: 'instagram', disabled: false }] }
    }
    return { body: { error: 'Not found.' }, status: 404 }
  }, 5679)
  try {
    await createPublishingWorkspace(identity, page)
    organizationId = await bindTestGoOrganization(page)
    await enablePublishingTwoFactor(page, identity.password)

    const start = await page
      .context()
      .request.get(getE2EUrl('/integrations/social/instagram/start'), {
        maxRedirects: 0,
      })
    expect(start.status(), `${await start.text()} ${backend.calls.map((call) => call.url)}`).toBe(
      303
    )
    expect(start.headers().location).toBe(
      `https://www.facebook.com/v24.0/dialog/oauth?state=${state}`
    )

    const callbackURL = getE2EUrl(`/integrations/social/instagram?code=test-code&state=${state}`)
    const picker = await page.context().request.get(callbackURL)
    expect(picker.status()).toBe(200)
    const choice = (await picker.text()).match(/name="choice" value="([^"]+)"/)?.[1]
    expect(choice).toBeTruthy()
    const selection = await page.context().request.post(callbackURL, {
      form: { choice: choice as string },
      headers: { origin: new URL(getE2EUrl('/')).origin },
    })
    expect(selection.status()).toBe(200)

    await expectOAuthConnection(organizationId, integrationId, state, 'instagram')

    const callsBeforeReplay = backend.calls.length
    const replay = await page.context().request.post(callbackURL, {
      form: { choice: choice as string },
      headers: { origin: new URL(getE2EUrl('/')).origin },
    })
    expect(replay.status()).toBe(403)
    expect(backend.calls).toHaveLength(callsBeforeReplay)
  } finally {
    await deleteOAuthStart(state)
    await unbindTestGoOrganization(organizationId)
    await backend.close()
  }
})

test('Instagram Login registers its destination after a one-use callback', async ({
  identity,
  page,
}) => {
  let organizationId: string | null = null
  const state = 'oauth-state-for-instagram-login'
  const integrationId = 'go-instagram-login-test-integration'
  const backend = await startHttpMockServer((request) => {
    if (request.url === '/api/public/v1/me') {
      return { body: { organization: { id: `go-${organizationId}` } } }
    }
    if (request.url === '/api/public/v1/social/instagram-standalone') {
      return { body: { url: `https://www.instagram.com/oauth/authorize?state=${state}` } }
    }
    if (request.url === '/integrations/social-connect/instagram-standalone') {
      return { body: { id: integrationId, pages: [] } }
    }
    if (request.url === '/api/public/v1/integrations') {
      return { body: [{ id: integrationId, identifier: 'instagram-standalone', disabled: false }] }
    }
    return { body: { error: 'Not found.' }, status: 404 }
  }, 5679)
  try {
    await createPublishingWorkspace(identity, page)
    organizationId = await bindTestGoOrganization(page)
    await enablePublishingTwoFactor(page, identity.password)

    const start = await page
      .context()
      .request.get(getE2EUrl('/integrations/social/instagram-standalone/start'), {
        maxRedirects: 0,
      })
    expect(start.status(), `${await start.text()} ${backend.calls.map((call) => call.url)}`).toBe(
      303
    )
    expect(start.headers().location).toBe(
      `https://www.instagram.com/oauth/authorize?state=${state}`
    )

    const callbackURL = getE2EUrl(
      `/integrations/social/instagram-standalone?code=test-code&state=${state}`
    )
    const callback = await page.context().request.get(callbackURL)
    expect(callback.status()).toBe(200)
    await expectOAuthConnection(organizationId, integrationId, state, 'instagram-standalone')
    const callsBeforeReplay = backend.calls.length
    expect((await page.context().request.get(callbackURL)).status()).toBe(403)
    expect(backend.calls).toHaveLength(callsBeforeReplay)
  } finally {
    await deleteOAuthStart(state)
    await unbindTestGoOrganization(organizationId)
    await backend.close()
  }
})

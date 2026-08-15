import type { Browser, Page } from '@playwright/test'
import { z } from 'zod'
import {
  enableTwoFactor,
  getActiveOrganizationId,
  openWorkspaceSetting,
  signUpAndCreateWorkspace,
} from './framework/auth'
import { browserRequest } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'
import { startHttpMockServer, type HttpMockRequest } from './framework/http-server'
import { createE2EDatabaseClient } from './framework/services'

const scimUserSchema = z.object({
  active: z.boolean(),
  id: z.string(),
  name: z.object({ formatted: z.string() }).optional(),
  userName: z.string(),
})

const scimListSchema = z.object({
  Resources: z.array(scimUserSchema),
  totalResults: z.number(),
})

function oidcPath(request: HttpMockRequest): string {
  return new URL(request.url, 'http://localhost').pathname
}

function createOidcHandler(email: string) {
  return (request: HttpMockRequest) => {
    const path = oidcPath(request)
    if (path === '/authorize') {
      const query = new URL(request.url, 'http://localhost').searchParams
      const callback = new URL(query.get('redirect_uri') ?? '')
      callback.searchParams.set('code', 'e2e-authorization-code')
      callback.searchParams.set('state', query.get('state') ?? '')
      return { headers: { location: callback.toString() }, rawBody: '', status: 302 }
    }
    if (path === '/token') {
      return { body: { access_token: 'e2e-access-token', token_type: 'Bearer' } }
    }
    if (path === '/userinfo') {
      return {
        body: {
          email,
          email_verified: true,
          name: 'SSO Test User',
          sub: `e2e-sso-${email}`,
        },
      }
    }
    return { body: { keys: [] } }
  }
}

async function signInWithSso(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Work email').fill(email)
  await page.getByRole('button', { name: 'Continue with SSO' }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
  return page
}

async function registerVerifiedOidcProvider(
  page: Page,
  organizationId: string,
  providerId: string,
  issuer: string,
  domain: string
): Promise<void> {
  const response = await browserRequest(page, '/api/auth/sso/register', {
    body: JSON.stringify({
      domain,
      issuer,
      oidcConfig: {
        authorizationEndpoint: 'http://localhost:5680/authorize',
        clientId: 'e2e-client-id',
        clientSecret: 'e2e-client-secret',
        jwksEndpoint: `${issuer}/jwks`,
        pkce: true,
        skipDiscovery: true,
        tokenEndpoint: `${issuer}/token`,
        tokenEndpointAuthentication: 'client_secret_post',
        userInfoEndpoint: `${issuer}/userinfo`,
      },
      organizationId,
      providerId,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (response.status !== 200) {
    throw new Error(`OIDC registration failed: ${JSON.stringify(response.body)}`)
  }

  const database = createE2EDatabaseClient()
  try {
    await database.ssoProvider.update({ data: { domainVerified: true }, where: { providerId } })
  } finally {
    await database.$disconnect()
  }
}

async function enableEnterpriseIdentity(organizationId: string): Promise<void> {
  const database = createE2EDatabaseClient()
  try {
    await database.organizationEnterpriseSettings.upsert({
      create: { organizationId, scimEnabled: true, ssoEnabled: true },
      update: { scimEnabled: true, ssoEnabled: true },
      where: { organizationId },
    })
  } finally {
    await database.$disconnect()
  }
}

async function createScimProviderToken(page: Page, providerId: string): Promise<string> {
  await openWorkspaceSetting(page, 'SSO')
  await page.getByPlaceholder('acme-scim').fill(providerId)
  await page.getByRole('button', { name: 'Generate token' }).click()
  await expect(page.getByText('Copy this SCIM token now. It cannot be shown again.')).toBeVisible()

  const token = await page.locator('code').last().textContent()
  if (!token) {
    throw new Error('SCIM token was not rendered.')
  }

  return token
}

function scimHeaders(token: string, hasBody = true): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    ...(hasBody ? { 'content-type': 'application/scim+json' } : {}),
  }
}

configureE2EFlow()

test('enterprise identity controls enforce the plan and create an audited SCIM connection', async ({
  identity,
  page,
}) => {
  test.slow()
  await signUpAndCreateWorkspace(identity, page)
  const organizationId = await getActiveOrganizationId(page)
  const providerId = `e2e-scim-${organizationId}`
  await enableTwoFactor(page, identity.password)
  await openWorkspaceSetting(page, 'SSO')

  await page.getByPlaceholder('acme-scim').fill(providerId)
  await page.getByRole('button', { name: 'Generate token' }).click()
  await expect(
    page.getByText('This organization does not have this enterprise feature.')
  ).toBeVisible()

  await enableEnterpriseIdentity(organizationId)
  await page.reload()
  await openWorkspaceSetting(page, 'SSO')
  await page.getByPlaceholder('acme-scim').fill(providerId)
  await page.getByRole('button', { name: 'Generate token' }).click()
  await expect(page.getByText('Copy this SCIM token now. It cannot be shown again.')).toBeVisible()
  await expect(page.getByText(providerId)).toBeVisible()

  const audit = await browserRequest(
    page,
    `/api/audit-logs?organizationId=${organizationId}&search=identity.scim_token_created`
  )
  expect(audit.status).toBe(200)
  expect(JSON.stringify(audit.body)).toContain('identity.scim_token_created')
})

test('a SCIM directory can provision, update, deactivate, list, and deprovision members', async ({
  identity,
  page,
}) => {
  test.slow()
  await signUpAndCreateWorkspace(identity, page)
  const organizationId = await getActiveOrganizationId(page)
  const providerId = `e2e-scim-${organizationId}`
  await enableEnterpriseIdentity(organizationId)
  await enableTwoFactor(page, identity.password)

  const token = await createScimProviderToken(page, providerId)
  const userName = `directory-${identity.email}`
  const created = await browserRequest(page, '/api/auth/scim/v2/Users', {
    body: JSON.stringify({
      emails: [{ primary: true, value: userName }],
      externalId: `directory-${organizationId}`,
      name: { formatted: 'Directory User' },
      userName,
    }),
    headers: scimHeaders(token),
    method: 'POST',
  })

  expect(created.status).toBe(201)
  const provisioned = scimUserSchema.parse(created.body)
  expect(provisioned.userName).toBe(userName)
  expect(provisioned.active).toBe(true)

  const listed = await browserRequest(page, '/api/auth/scim/v2/Users', {
    headers: scimHeaders(token),
  })
  expect(listed.status).toBe(200)
  expect(scimListSchema.parse(listed.body).totalResults).toBe(1)

  const renamed = await browserRequest(page, `/api/auth/scim/v2/Users/${provisioned.id}`, {
    body: JSON.stringify({
      Operations: [{ op: 'replace', path: 'name.formatted', value: 'Directory User Renamed' }],
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
    }),
    headers: scimHeaders(token),
    method: 'PATCH',
  })
  expect(renamed.status).toBe(204)

  const deactivated = await browserRequest(page, `/api/auth/scim/v2/Users/${provisioned.id}`, {
    body: JSON.stringify({
      Operations: [{ op: 'replace', path: 'active', value: false }],
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
    }),
    headers: scimHeaders(token),
    method: 'PATCH',
  })
  expect(deactivated.status).toBe(204)

  const database = createE2EDatabaseClient()
  try {
    await expect
      .poll(async () => {
        const user = await database.user.findUnique({ where: { id: provisioned.id } })
        return { banned: user?.banned, name: user?.name }
      })
      .toEqual({ banned: true, name: 'Directory User Renamed' })

    const removed = await browserRequest(page, `/api/auth/scim/v2/Users/${provisioned.id}`, {
      headers: scimHeaders(token, false),
      method: 'DELETE',
    })
    expect(removed.status).toBe(204)

    await expect
      .poll(async () => {
        const [account, membership] = await Promise.all([
          database.account.findFirst({
            where: { providerId, userId: provisioned.id },
          }),
          database.member.findFirst({ where: { organizationId, userId: provisioned.id } }),
        ])
        return { account: Boolean(account), membership: Boolean(membership) }
      })
      .toEqual({ account: false, membership: false })
  } finally {
    await database.$disconnect()
  }
})

test('a verified OIDC provider signs a user in and provisions the workspace membership', async ({
  browser,
  identity,
  page,
}) => {
  test.slow()
  const ssoDomain = `e2e-sso-${identity.email.split('@')[0]}.test`
  const ssoEmail = `member@${ssoDomain}`
  const provider = await startHttpMockServer(createOidcHandler(ssoEmail), 5680)
  try {
    await signUpAndCreateWorkspace(identity, page)
    const organizationId = await getActiveOrganizationId(page)
    const providerId = `e2e-oidc-${organizationId}`
    await enableEnterpriseIdentity(organizationId)
    await enableTwoFactor(page, identity.password)
    await registerVerifiedOidcProvider(
      page,
      organizationId,
      providerId,
      provider.containerUrl,
      ssoDomain
    )

    const ssoPage = await signInWithSso(browser, ssoEmail)
    await expect.poll(() => getActiveOrganizationId(ssoPage)).toBe(organizationId)
    const database = createE2EDatabaseClient()
    try {
      await expect
        .poll(async () => {
          const user = await database.user.findUnique({ where: { email: ssoEmail } })
          const member = user
            ? await database.member.findUnique({
                where: { organizationId_userId: { organizationId, userId: user.id } },
              })
            : null
          return { email: user?.email, role: member?.role }
        })
        .toEqual({ email: ssoEmail, role: 'member' })
    } finally {
      await database.$disconnect()
      await ssoPage.context().close()
    }
    expect(provider.calls.map(oidcPath)).toEqual(
      expect.arrayContaining(['/authorize', '/token', '/userinfo'])
    )
  } finally {
    await provider.close()
  }
})

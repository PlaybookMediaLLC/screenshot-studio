import { z } from 'zod'
import {
  acceptInvitation,
  browserRequest,
  createWorkspace,
  type E2EIdentity,
  expect,
  findActiveOrganizationId,
  getActiveOrganizationId,
  requestJson,
  test,
} from './framework'

const invitationSchema = z.object({ id: z.string() })
const releasesSchema = z.object({ releases: z.array(z.object({ title: z.string() })) })

async function createRelease(
  page: Parameters<typeof requestJson>[0],
  title: string
): Promise<void> {
  const response = await requestJson(page, '/api/tenant/releases', {
    benefitStatement: `${title} benefit.`,
    title,
  })
  expect(response.status).toBe(201)
}

async function assertReleaseIsolation(
  page: Parameters<typeof browserRequest>[0],
  includedTitle: string,
  excludedTitle: string
): Promise<void> {
  const response = await browserRequest(page, '/api/tenant/releases')
  const titles = releasesSchema.parse(response.body).releases.map((release) => release.title)
  expect(response.status).toBe(200)
  expect(titles).toContain(includedTitle)
  expect(titles).not.toContain(excludedTitle)
}

async function switchWorkspace(
  page: Parameters<typeof browserRequest>[0],
  workspaceName: string
): Promise<void> {
  // One menu holds workspace switching and the account, as in Polar's sidebar footer.
  await page.getByRole('button', { name: 'Open account menu' }).click()
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.getByRole('button', { name: `Switch to ${workspaceName}` }).click(),
  ])
}

test('a member can switch workspaces without crossing tenant data', async ({
  app,
  browser,
  identity,
  page,
  workspace,
}) => {
  const firstTitle = 'First workspace release'
  const secondIdentity: E2EIdentity = {
    ...identity,
    email: `second-owner-${identity.email}`,
    workspaceName: `Second ${identity.workspaceName}`,
  }
  const firstOrganizationId = workspace.id
  await createRelease(page, firstTitle)
  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()

  try {
    await createWorkspace(secondIdentity, secondPage)
    const secondOrganizationId = await getActiveOrganizationId(secondPage)
    const secondTitle = 'Second workspace release'
    await createRelease(secondPage, secondTitle)
    const invitation = invitationSchema.parse(
      (
        await requestJson(secondPage, '/api/auth/organization/invite-member', {
          email: identity.email,
          organizationId: secondOrganizationId,
          role: 'viewer',
        })
      ).body
    )

    await acceptInvitation(page, invitation.id)
    await expect.poll(() => findActiveOrganizationId(page)).toBe(secondOrganizationId)
    await app.open('/')
    await assertReleaseIsolation(page, secondTitle, firstTitle)

    await switchWorkspace(page, identity.workspaceName)
    await expect.poll(() => findActiveOrganizationId(page)).toBe(firstOrganizationId)
    await assertReleaseIsolation(page, firstTitle, secondTitle)

    await switchWorkspace(page, secondIdentity.workspaceName)
    await expect.poll(() => findActiveOrganizationId(page)).toBe(secondOrganizationId)
    await assertReleaseIsolation(page, secondTitle, firstTitle)

    await page.getByRole('button', { name: 'Open account menu' }).click()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/sign-in')
    await page.getByLabel('Email', { exact: true }).fill(identity.email)
    await page.getByLabel('Password').fill(identity.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect.poll(() => findActiveOrganizationId(page)).toBe(firstOrganizationId)
    await assertReleaseIsolation(page, firstTitle, secondTitle)
  } finally {
    await secondContext.close()
  }
})

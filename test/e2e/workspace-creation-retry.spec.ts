import { z } from 'zod'
import { getActiveOrganizationId, signUpViaApi } from './framework/auth'
import { requestJson } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'
import { createE2EDatabase, grantWorkspacePlan } from './framework/services'

const creationRowsSchema = z.array(
  z.object({ id: z.string(), name: z.string(), role: z.literal('owner'), audits: z.number() })
)

configureE2EFlow()

test('retrying team creation after a lost committed response keeps one workspace', async ({
  identity,
  page,
}, testInfo) => {
  await signUpViaApi(identity, page)
  expect(
    (
      await requestJson(page, '/api/auth/sign-in/email', {
        email: identity.email,
        password: identity.password,
      })
    ).status
  ).toBe(200)
  await page.goto('/onboarding')
  await page.getByRole('textbox', { name: 'Workspace name' }).fill(identity.workspaceName)
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Choose a plan' })).toBeVisible()
  const originalId = await getActiveOrganizationId(page)
  await grantWorkspacePlan(originalId, 'pro')
  await page.goto('/workspace/new-team')
  const name = `${identity.workspaceName} retry`
  await page.getByRole('textbox', { name: 'Workspace name' }).fill(name)
  const requests: string[] = []
  await page.route('**/api/trpc/workspace.create*', async (route) => {
    requests.push(route.request().postData() ?? '')
    if (requests.length === 1) {
      // The real backend commits; only delivery of its browser response fails.
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await route.abort('connectionreset')
      return
    }
    await route.continue()
  })
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect.poll(() => requests.length).toBe(1)
  await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toBeEnabled()
  await expect(page.getByRole('textbox', { name: 'Workspace name' })).toHaveValue(name)
  const committedId = await getActiveOrganizationId(page)
  expect(committedId).not.toBe(originalId)
  await page.screenshot({ path: testInfo.outputPath('workspace-creation-retry.png') })
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Members', exact: true })).toBeVisible()
  await expect(page.getByText('1 member', { exact: true })).toBeVisible()
  await expect(page.getByText(identity.email, { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('workspace-creation-recovered.png') })
  expect(requests).toHaveLength(2)
  expect(requests[1]).toBe(requests[0])
  expect(await getActiveOrganizationId(page)).toBe(committedId)
  const db = createE2EDatabase()
  try {
    const result = await db.query(
      `SELECT o.id,o.name,m.role,
        (SELECT count(*)::int FROM audit_log a WHERE a."organizationId"=o.id AND a.action='product.workspace_created') AS audits
       FROM organization o
       JOIN member m ON m."organizationId"=o.id
       JOIN "user" u ON u.id=m."userId"
       WHERE u.email=$1 AND o.name=$2`,
      [identity.email, name]
    )
    expect(creationRowsSchema.parse(result.rows)).toEqual([
      { id: committedId, name, role: 'owner', audits: 1 },
    ])
  } finally {
    await db.end()
  }
})

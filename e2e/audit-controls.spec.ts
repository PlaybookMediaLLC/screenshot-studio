import {
  enableTwoFactor,
  getActiveOrganizationId,
  openWorkspaceSetting,
  signUpAndCreateWorkspace,
} from './framework/auth'
import { browserRequest } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'

configureE2EFlow()

test('an owner can manage and search audited retention and SIEM controls', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const organizationId = await getActiveOrganizationId(page)
  await enableTwoFactor(page, identity.password)
  await openWorkspaceSetting(page, 'Audit log')

  await page.getByLabel('Retention days').fill('91')
  await page.getByRole('button', { name: 'Save retention' }).click()
  await page.getByPlaceholder('Production SIEM').fill('E2E SIEM')
  await page.getByPlaceholder('https://siem.example/events').fill('https://siem.example/events')
  await page.getByPlaceholder('Signing secret').fill('e2e-signing-secret')
  await page.getByRole('button', { name: 'Add log drain' }).click()
  await expect(page.getByText('E2E SIEM')).toBeVisible()
  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('No SIEM drains are configured.')).toBeVisible()

  await page.getByLabel('Search audit events').fill('audit.retention_changed')
  await expect(page.getByText('audit.retention_changed')).toBeVisible()

  const filteredLogs = await browserRequest(
    page,
    `/api/audit-logs?organizationId=${organizationId}&search=audit.retention_changed`
  )
  expect(filteredLogs.status).toBe(200)
  expect(JSON.stringify(filteredLogs.body)).toContain('audit.retention_changed')
})

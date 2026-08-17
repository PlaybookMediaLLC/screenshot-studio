import { openWorkspaceSetting, signUpAndCreateWorkspace } from './framework/auth'
import { configureE2EFlow, expect, test } from './framework/flow'

configureE2EFlow()

test('an owner can persist workspace, profile, and active brand-kit settings', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const workspaceName = `${identity.workspaceName} Updated`
  const workspaceSlug = `workspace-${identity.email.split('@')[0]}`

  await openWorkspaceSetting(page, 'General')
  await page.getByLabel('Workspace name').fill(workspaceName)
  await page.getByLabel('Workspace slug').fill(workspaceSlug)
  await page.getByRole('button', { name: 'Save workspace' }).click()
  await expect(page.getByText('Workspace details updated.')).toBeVisible()

  await openWorkspaceSetting(page, 'Account')
  await page.getByLabel('Name').fill('Updated E2E User')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Profile updated.')).toBeVisible()

  await openWorkspaceSetting(page, 'Brand kit')
  await page.getByLabel('Brand kit name').fill('Launch system')
  await page.getByLabel('Primary typeface').fill('Inter')
  await page.getByRole('button', { name: 'Publish brand kit' }).click()
  await expect(page.getByText('Launch system')).toBeVisible()
  await expect(page.getByText('v1 · active')).toBeVisible()

  await page.reload()
  await expect(
    page.locator('main > header').getByText(workspaceName, { exact: true })
  ).toBeVisible()
})

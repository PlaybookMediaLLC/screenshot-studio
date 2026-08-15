import { configureE2EFlow, expect, test } from './framework/flow'

configureE2EFlow({
  beforeEach: async ({ app }) => {
    await app.open('/')
    await app.expectPath('/sign-in')
  },
})

test('a new user can create an account and workspace', async ({ app, identity, page }) => {
  await app.open('/sign-up')
  await page.getByLabel('Name').fill(identity.name)
  await page.getByLabel('Email').fill(identity.email)
  await page.getByLabel('Password').fill(identity.password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await app.expectPath('/onboarding')
  await page.getByLabel('Workspace name').fill(identity.workspaceName)
  await page.getByRole('button', { name: 'Create workspace' }).click()

  await app.expectPath('/')
  await app.open('/onboarding')
  await app.expectPath('/')
  await expect(page.getByRole('button', { exact: true, name: 'Save' })).toBeVisible()
})

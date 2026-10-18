import { configureE2EFlow, expect, test } from './framework/flow'
import { signUpAndCreateWorkspace } from './framework/auth'

configureE2EFlow()

test('a signed-out user cannot open protected routes and can return after sign-in', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  await page.getByLabel('Open account menu').click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/sign-in')

  await page.goto('/workspace')
  await expect.poll(() => new URL(page.url()).pathname).toBe('/sign-in')

  await page.goto('/sign-in?callbackURL=/workspace')
  await page.getByLabel('Email', { exact: true }).fill(identity.email)
  await page.getByLabel('Password').fill(identity.password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect.poll(() => new URL(page.url()).pathname).toBe('/workspace')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
})

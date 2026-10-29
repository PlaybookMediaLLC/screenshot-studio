import { expect, signUp, test } from './framework'

test.beforeEach(async ({ app }) => {
  await app.open('/')
  await app.expectPath('/sign-in')
})

test(
  'a new user can create an account and workspace',
  { tag: '@smoke' },
  async ({ app, identity, page }) => {
    // The sign-up form; a production build signs in after it (no auto sign-in).
    await signUp(identity, page)
    await page.getByLabel('Workspace name').fill(identity.workspaceName)
    await page.getByRole('button', { name: 'Create workspace' }).click()

    // There is no free plan: onboarding ends by choosing one.
    await app.expectPath('/onboarding/plan')
    await expect(page.getByRole('heading', { name: 'Choose a plan' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Continue with free scheduling' })).toHaveCount(0)
    await app.open('/onboarding')
    await app.expectPath('/onboarding')
    await expect(page.getByRole('button', { name: 'Create workspace' })).toBeVisible()
  }
)

import type { Page } from '@playwright/test'
import { getTotpCode } from './framework/totp'
import { enableTwoFactor, getE2EUrl, signUpAndCreateWorkspace } from './framework/auth'
import { requestJson } from './framework/browser'
import { configureE2EFlow, expect, test, type E2EIdentity } from './framework/flow'

async function startTwoFactorSignIn(page: Page, identity: E2EIdentity): Promise<void> {
  await page.goto(getE2EUrl('/sign-in'))
  await page.getByLabel('Email', { exact: true }).fill(identity.email)
  await page.getByLabel('Password').fill(identity.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/two-factor')
}

async function signOut(page: Page): Promise<void> {
  expect((await requestJson(page, '/api/auth/sign-out', {})).status).toBe(200)
}

configureE2EFlow()

test('two-factor sign-in accepts a TOTP or one-time recovery code and rejects replay', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const setup = await enableTwoFactor(page, identity.password)
  const recoveryCode = setup.backupCodes[0]
  if (!recoveryCode) throw new Error('Two-factor setup did not return a recovery code.')

  await signOut(page)
  await startTwoFactorSignIn(page, identity)
  await page.getByLabel('Authenticator code').fill(getTotpCode(setup.totpURI))
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')

  await signOut(page)
  await startTwoFactorSignIn(page, identity)
  await page.getByRole('button', { name: 'Use a recovery code' }).click()
  await page.getByLabel('Recovery code').fill(recoveryCode)
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')

  await signOut(page)
  await startTwoFactorSignIn(page, identity)
  await page.getByRole('button', { name: 'Use a recovery code' }).click()
  await page.getByLabel('Recovery code').fill(recoveryCode)
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await expect(page.getByText('Invalid backup code')).toBeVisible()
})

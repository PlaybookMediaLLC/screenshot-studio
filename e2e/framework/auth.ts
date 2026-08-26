import { z } from 'zod'
import { expect, type Page } from '@playwright/test'
import type { E2EIdentity } from './flow'
import { browserJson } from './browser'
import { getTotpCode } from './totp'

const sessionSchema = z.object({
  session: z.object({ activeOrganizationId: z.string().nullable() }),
})

export type TwoFactorSetup = { backupCodes: string[]; totpURI: string }

export async function signUpAndCreateWorkspace(identity: E2EIdentity, page: Page): Promise<string> {
  await signUp(identity, page)
  await page.getByLabel('Workspace name').fill(identity.workspaceName)
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expectPath(page, '/')
  await waitForEditorHydration(page)
  await expect(page.getByRole('button', { exact: true, name: 'Save' })).toBeVisible()
  return getActiveOrganizationId(page)
}

export async function signUp(identity: E2EIdentity, page: Page): Promise<void> {
  await page.goto(getE2EUrl('/sign-up'))
  await page.getByLabel('Name').fill(identity.name)
  await page.getByLabel('Email').fill(identity.email)
  await page.getByLabel('Password').fill(identity.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expectPath(page, '/onboarding')
}

/**
 * Create an account through the API rather than the sign-up form.
 *
 * Specs that assert on what an account may do, rather than on how it was
 * created, do not need the form. Driving the UI for each of them costs a
 * page load and four field interactions per account, which dominates the
 * runtime of any spec that needs several accounts and pushes it into
 * timeout territory for reasons unrelated to what it verifies.
 *
 * Sign-up through the form stays covered by the specs that exist to
 * exercise it.
 */
export async function signUpViaApi(identity: E2EIdentity, page: Page): Promise<void> {
  await page.goto(getE2EUrl('/sign-up'))
  await browserJson(page, '/api/auth/sign-up/email', {
    body: JSON.stringify({
      email: identity.email,
      name: identity.name,
      password: identity.password,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
}

export async function acceptInvitation(page: Page, invitationId: string): Promise<void> {
  await page.goto(getE2EUrl(`/accept-invitation?invitationId=${invitationId}`))
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.getByRole('button', { name: 'Accept invitation' }).click(),
  ])
  await expectPath(page, '/workspace')
}

export function getE2EUrl(path: string): string {
  return new URL(path, process.env.E2E_BASE_URL ?? 'http://localhost:3000').toString()
}

async function expectPath(page: Page, path: string): Promise<void> {
  await expect.poll(() => new URL(page.url()).pathname).toBe(path)
}

async function waitForEditorHydration(page: Page): Promise<void> {
  const templates = page.getByRole('button', { exact: true, name: 'Templates' })
  // The button is present in the server-rendered markup with
  // `aria-expanded="false"`, so it is clickable before React attaches its
  // handler and an early click is silently dropped. Waiting for the element
  // first keeps the retry loop about hydration rather than about rendering,
  // which matters on a cold Next.js route that compiles on first request.
  await expect(templates).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    await templates.click()
    expect(await templates.getAttribute('aria-expanded')).toBe('true')
  }).toPass({ timeout: 60_000 })
  await templates.click()
  await expect(templates).toHaveAttribute('aria-expanded', 'false')
}

export async function getActiveOrganizationId(page: Page): Promise<string> {
  const result = sessionSchema.parse(await browserJson(page, '/api/auth/get-session'))
  if (!result.session.activeOrganizationId) {
    throw new Error('The signed-in user has no active organization.')
  }

  return result.session.activeOrganizationId
}

/**
 * The active organization id once the session exists, or null while it does not.
 *
 * `/api/auth/get-session` returns null for a short window after a sign-in
 * submit, before the session cookie is readable. `getActiveOrganizationId`
 * throws in that window, and a throw inside `expect.poll` fails the assertion
 * outright rather than retrying, so polling on it turns an ordinary race into
 * a hard failure. Callers that are waiting for a sign-in to land should poll
 * this instead and let the returned value settle.
 */
export async function findActiveOrganizationId(page: Page): Promise<string | null> {
  const parsed = sessionSchema.safeParse(await browserJson(page, '/api/auth/get-session'))
  if (!parsed.success) return null

  return parsed.data.session.activeOrganizationId
}

export async function enableTwoFactor(page: Page, password: string): Promise<TwoFactorSetup> {
  await openWorkspaceSetting(page, 'Security')
  await page.getByLabel('Current password').fill(password)
  await page.getByRole('button', { name: 'Set up authenticator' }).click()
  await expect(page.locator('code').first()).toContainText('otpauth://')
  const codes = await page.locator('code').allTextContents()
  const uri = codes[0]
  if (!uri) {
    throw new Error('Two-factor setup did not provide a TOTP URI.')
  }

  await page.getByLabel('Verification code').fill(getTotpCode(uri))
  await page.getByRole('button', { name: 'Verify and enable' }).click()
  await expect(
    page.getByText('Two-factor authentication is enabled for this account.')
  ).toBeVisible()
  return { backupCodes: codes.slice(1), totpURI: uri }
}

export async function openWorkspaceSetting(page: Page, name: string): Promise<void> {
  await page.goto('/workspace', { timeout: 20_000, waitUntil: 'load' })
  await page
    .getByRole('navigation', { name: 'Workspace settings' })
    .getByRole('button', { exact: true, name })
    .click()
  await expect(page.getByRole('heading', { exact: true, level: 2, name })).toBeVisible()
}

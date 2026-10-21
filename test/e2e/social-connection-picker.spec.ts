import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { socialSetListSchema, socialSetSchema } from '../../lib/api/contracts/social-sets'
import { socialMockPort } from './framework/content-drafts'
import { configureE2EFlow, expect, test } from './framework/flow'
import { getE2EUrl } from './framework/auth'
import { startHttpMockServer } from './framework/http-server'
import {
  apiRequest,
  bindTestGoOrganization,
  createPublishingWorkspace,
  enablePublishingTwoFactor,
  unbindTestGoOrganization,
} from './framework/publishing'
import { createE2EDatabase } from './framework/services'

configureE2EFlow()

test('provider-first creation stays layered, commits once, and preserves its set target', async ({
  identity,
  page,
}) => {
  let organizationId: string | null = null
  const state = randomUUID()
  const externalId = `picker-${randomUUID()}`
  const provider = await startHttpMockServer((request) => {
    if (request.url === '/api/public/v1/me')
      return { body: { organization: { id: `go-${organizationId}` } } }
    if (request.url === '/api/public/v1/social/x')
      return { body: { url: `https://api.x.com/oauth/authenticate?oauth_token=${state}` } }
    if (request.url === '/integrations/social-connect/x')
      return { body: { id: externalId, pages: [] } }
    if (request.url === '/api/public/v1/integrations')
      return { body: [{ id: externalId, identifier: 'x', disabled: false }] }
    return { status: 404 }
  }, socialMockPort)
  const list = async () => {
    const response = await apiRequest(page, '/api/v1/social-sets')
    expect(response.status).toBe(200)
    return socialSetListSchema.parse(response.body).items
  }
  try {
    await createPublishingWorkspace(identity, page)
    await enablePublishingTwoFactor(page, identity.password)
    organizationId = await bindTestGoOrganization(page)
    await page.goto('/workspace/social-sets?picker=preserve')
    await expect(page.getByText('No brands yet', { exact: true })).toBeVisible()
    expect(await list()).toHaveLength(0)
    const originalURL = page.url()
    const launch = page.getByRole('button', { name: 'Add social set to your personal workspace' })
    await launch.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Create a social set' })).toBeVisible()
    await expect(
      dialog.getByText('Private to you in this workspace', { exact: true })
    ).toBeVisible()
    await expect(dialog.getByRole('textbox')).toHaveCount(0)
    for (const label of [
      'X / Twitter',
      'LinkedIn',
      'Mastodon',
      'Threads',
      'Bluesky',
      'Substack Notes',
    ]) {
      await expect(dialog.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
    for (const label of ['LinkedIn', 'Threads']) {
      await dialog.getByRole('button', { name: label, exact: true }).click()
      await expect(dialog.getByText(`You’ll go to ${label}`, { exact: false })).toBeVisible()
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(dialog.getByRole('button', { name: label, exact: true })).toBeFocused()
    }
    await dialog.getByRole('button', { name: 'Substack Notes', exact: true }).click()
    await expect(
      dialog.getByText('Substack does not offer a public publishing API', { exact: false })
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Connection unavailable' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog.getByRole('heading', { name: 'Create a social set' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(launch).toBeFocused()
    expect(page.url()).toBe(originalURL)
    expect(await list()).toHaveLength(0)
    expect(provider.calls).toHaveLength(0)

    // Authorization is a fixture page; no real provider account or credentials are used.
    await page.route('https://api.x.com/oauth/authenticate**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<main><h1>Fixture X authorization</h1></main>',
      })
    )
    await launch.click()
    await dialog.getByRole('button', { name: 'X / Twitter', exact: true }).click()
    await expect(dialog.getByRole('link', { name: 'Switch X account' })).toHaveAttribute(
      'href',
      'https://x.com/account/switch'
    )
    await page.screenshot({ path: '.context/social-connection-picker.png', animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Connect X account', exact: true }).click()
    await expect(page).toHaveURL(`https://api.x.com/oauth/authenticate?oauth_token=${state}`)
    expect(await list()).toHaveLength(0)

    const callback = getE2EUrl(
      `/integrations/social/x?oauth_token=${state}&oauth_verifier=fixture-verifier`
    )
    await page.goto(callback)
    await expect(page).toHaveURL(/\/workspace\/social-sets\/[a-z0-9]+\?connected=x$/)
    const sets = await list()
    expect(sets).toHaveLength(1)
    const created = socialSetSchema.parse(sets[0])
    expect(created.visibility).toBe('PRIVATE')
    expect(created.accounts).toHaveLength(1)
    expect(created.accounts[0]?.platform).toBe('x')
    await expect(page.getByLabel('Brand name', { exact: true })).toHaveValue('New brand')
    await page.getByRole('button', { name: 'Add social account', exact: true }).click()
    await expect(dialog.getByRole('heading', { name: 'Add account to “New brand”' })).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'X / Twitter Connected', exact: true })
    ).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'LinkedIn', exact: true })).toBeEnabled()
    await page.keyboard.press('Escape')
    await page.goto(callback)
    expect((await list()).map((item) => item.id)).toEqual([created.id])
    expect(
      provider.calls.filter((call) => call.url === '/integrations/social-connect/x')
    ).toHaveLength(1)
    const database = createE2EDatabase()
    try {
      const receipt = await database.query(
        'SELECT "exchangeStatus", "createdSocialSetId" FROM social_oauth_start WHERE state=$1',
        [state]
      )
      expect(
        z
          .array(
            z.object({
              exchangeStatus: z.literal('COMPLETED'),
              createdSocialSetId: z.literal(created.id),
            })
          )
          .parse(receipt.rows)
      ).toHaveLength(1)
    } finally {
      await database.end()
    }
  } finally {
    await unbindTestGoOrganization(organizationId)
    await provider.close()
  }
})

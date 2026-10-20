import { type Page } from '@playwright/test'
import { openWorkspaceSetting, signUpAndCreateWorkspace } from './framework/auth'
import {
  createDraftWorkspace,
  type DraftWorkspace,
  draftEditor,
  expectSaved,
  openNewDraft,
} from './framework/content-drafts'
import { configureE2EFlow, expect, test } from './framework/flow'
import { unbindTestGoOrganization } from './framework/publishing'
import { createE2EDatabase, queryRow } from './framework/services'

configureE2EFlow()

// RFC 043: settings a person, a workspace and a social set own. Every change
// is checked after a reload, so a save the server did not keep fails here.

async function withDraftWorkspace(
  identity: Parameters<typeof createDraftWorkspace>[0],
  page: Page,
  run: (workspace: DraftWorkspace) => Promise<void>
): Promise<void> {
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page, ['x', 'linkedin'])
    await run(workspace)
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
}

async function slotCount(setId: string): Promise<number> {
  const database = createE2EDatabase()
  try {
    const row = await queryRow<{ count: number }>(
      database,
      `SELECT jsonb_array_length("postingSlots")::int AS count FROM social_set WHERE id = $1`,
      [setId]
    )
    return row?.count ?? -1
  } finally {
    await database.end()
  }
}

test('personal settings are addressable, saved on the server and survive a reload', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)

  await openWorkspaceSetting(page, 'Appearance')
  await page.getByRole('radio', { name: /^Light/ }).check()
  await expect(page.locator('html')).toHaveClass(/\blight\b/)
  await expect(page.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('radio', { name: /^Light/ })).toBeChecked()
  await expect(page.locator('html')).toHaveClass(/\blight\b/)
  await page.getByRole('radio', { name: /^Sunday/ }).check()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible()

  // Each section is its own address, so back and forward move between them.
  await openWorkspaceSetting(page, 'Notifications')
  await page.goBack()
  await expect(page).toHaveURL(/\/workspace\/appearance$/)
  await page.goForward()
  await expect(page).toHaveURL(/\/workspace\/notifications$/)

  const email = page.getByRole('switch', { name: 'Email notifications' })
  await expect(email).toBeChecked()
  await email.click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Email notifications' })).not.toBeChecked()
  await expect(page.getByText('Slack direct messages are not available')).toBeVisible()

  await openWorkspaceSetting(page, 'Account')
  await page.getByLabel('Search display time zone').fill('Tokyo')
  await page.getByLabel('Display time zone', { exact: true }).selectOption('Asia/Tokyo')
  await expect(page.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Display time zone', { exact: true })).toHaveValue('Asia/Tokyo')

  // The registry says what each experiment is, and promoted or unavailable
  // ones cannot be switched.
  await openWorkspaceSetting(page, 'Experimental')
  await expect(page.getByText('Draft tags')).toBeVisible()
  const tags = page.getByRole('switch', { name: /^Draft tags/ })
  await tags.click()
  await expect(tags).toBeChecked()
  await page.reload()
  await expect(page.getByRole('switch', { name: /^Draft tags/ })).toBeChecked()
})

test('a webhook secret shows once, and private addresses are refused', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  await openWorkspaceSetting(page, 'API')
  await page.getByRole('button', { name: 'Add webhook' }).click()
  await page.getByPlaceholder('Zapier').fill('Refused')
  await page.getByPlaceholder('https://example.com/hooks/shots').fill('https://localhost/hook')
  await page.getByRole('checkbox', { name: /draft\.created/ }).check()
  await page.getByRole('button', { name: 'Add webhook' }).click()
  await expect(page.getByText(/private|internal|not allowed|refused/i).first()).toBeVisible()

  await page.getByPlaceholder('Zapier').fill('Receiver')
  await page
    .getByPlaceholder('https://example.com/hooks/shots')
    .fill('https://example.com/shots-e2e')
  await page.getByRole('button', { name: 'Add webhook' }).click()
  const notice = page.getByText('Copy this signing secret now. It is not shown again.')
  await expect(notice).toBeVisible()
  const secret = (await page.locator('code', { hasText: /^whsec_/ }).textContent()) ?? ''
  expect(secret).toMatch(/^whsec_/)

  await page.reload()
  await expect(page.getByText('Receiver')).toBeVisible()
  await expect(notice).toHaveCount(0)
  await expect(page.getByText(secret)).toHaveCount(0)
})

test('social sets keep their own names, schedules and settings beside the composer', async ({
  identity,
  page,
}) => {
  await withDraftWorkspace(identity, page, async () => {
    await page.goto('/workspace/social-sets')
    await expect(
      page.getByRole('heading', { exact: true, level: 2, name: 'Social sets' })
    ).toBeVisible()

    // Two sets may share a name; each is its own by ID.
    const ids: string[] = []
    for (let i = 0; i < 2; i++) {
      await page.goto('/workspace/social-sets')
      await page.getByPlaceholder('Person or brand').fill('Brand')
      await page.getByRole('button', { name: 'Create social set' }).click()
      await page.waitForURL(/\/workspace\/social-sets\/[a-z0-9]+/)
      ids.push(new URL(page.url()).pathname.split('/')[3] ?? '')
    }
    expect(ids[0]).not.toEqual(ids[1])
    const setId = ids[1] ?? ''

    // A new set posts weekdays at 9:00. A second weekday time makes two rows
    // of five: ten weekly slots, as the server saved them.
    await page.goto(`/workspace/social-sets/${setId}/scheduling`)
    await expect(page.getByTestId('weekly-slot-count')).toHaveText('5 weekly posting slots')
    await page.getByLabel('Search scheduling time zone').fill('Paris')
    await page.getByLabel('Scheduling time zone', { exact: true }).selectOption('Europe/Paris')
    await expect(page.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible()
    await page.getByLabel('Time to add').selectOption('13:00')
    await page.getByRole('button', { name: 'Add time' }).click()
    await expect(page.getByTestId('weekly-slot-count')).toHaveText('10 weekly posting slots')
    await expect.poll(() => slotCount(setId)).toBe(10)
    await page.reload()
    await expect(page.getByTestId('weekly-slot-count')).toHaveText('10 weekly posting slots')
    await expect(page.getByLabel('Scheduling time zone', { exact: true })).toHaveValue(
      'Europe/Paris'
    )

    // Settings open beside a draft without losing what was typed.
    await openNewDraft(page)
    await draftEditor(page).click()
    await page.keyboard.type('Unsaved thought stays put')
    await page.getByRole('button', { exact: true, name: 'Settings' }).click()
    await expect(page).toHaveURL(/[?&]settings=scheduling/)
    await expect(page.getByRole('dialog')).toContainText('weekly posting slots')
    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(draftEditor(page)).toContainText('Unsaved thought stays put')
    await expectSaved(page)
  })
})

test('a public profile is served only while it is turned on', async ({
  browser,
  identity,
  page,
}) => {
  await withDraftWorkspace(identity, page, async () => {
    await page.goto('/workspace/social-sets')
    await page
      .getByRole('link', { name: /^Settings for / })
      .first()
      .click()
    await page.waitForURL(/\/workspace\/social-sets\/[a-z0-9]+/)
    const setId = new URL(page.url()).pathname.split('/')[3] ?? ''
    await page.goto(`/workspace/social-sets/${setId}/public-profile`)
    const toggle = page.getByRole('switch', { name: 'Make profile public' })
    await toggle.click()
    await expect(toggle).toBeChecked()
    const address = (await page.locator('code', { hasText: '/p/' }).textContent()) ?? ''
    expect(address).toMatch(/\/p\/[0-9a-f]{24}$/)
    const path = new URL(address).pathname

    const visitor = await browser.newContext()
    try {
      const anonymous = await visitor.newPage()
      const shown = await anonymous.goto(path)
      expect(shown?.status()).toBe(200)
      await expect(anonymous.getByText('@shots_x')).toBeVisible()

      await toggle.click()
      await expect(toggle).not.toBeChecked()
      await expect(page.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible()
      const hidden = await anonymous.goto(path)
      expect(hidden?.status()).toBe(404)
    } finally {
      await visitor.close()
    }
  })
})

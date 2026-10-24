import { expect } from '@playwright/test'
import {
  createDraftWorkspace,
  draftEditor,
  expectSaved,
  openNewDraft,
  type DraftWorkspace,
} from './framework/content-drafts'
import { configureE2EFlow, test } from './framework/flow'
import { unbindTestGoOrganization } from './framework/publishing'
configureE2EFlow()

test('scheduling opens a fresh draft in the same social set and keeps the commitment in Queue', async ({
  identity,
  page,
}) => {
  test.setTimeout(180_000)
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page, ['x'])
    const original = await openNewDraft(page)
    await draftEditor(page).click()
    await page.waitForTimeout(300)
    await page.keyboard.press('ControlOrMeta+End')
    await page.waitForTimeout(150)
    await page.keyboard.type('A scheduled post followed by a fresh draft')
    await expectSaved(page)
    await page.getByTestId('schedule-button').click()
    const dialog = page.getByTestId('schedule-dialog')
    await dialog.getByRole('button', { name: /^Tomorrow 9:00/ }).click()
    await expect(dialog.getByLabel('Open a new draft after scheduling')).toBeChecked()
    await dialog.getByRole('button', { name: /^Confirm schedule/ }).click()
    await page.waitForURL(
      (url) => /\/write\/[a-z0-9]+/.test(url.pathname) && !url.pathname.endsWith(original)
    )
    await expect(draftEditor(page)).not.toContainText('A scheduled post followed')
    await expect(page.getByTestId('platform-tab-x')).toBeVisible()
    await page.goto('/write?tab=queue')
    await expect(page.getByTestId('write-rail')).toContainText(
      'A scheduled post followed by a fresh draft'
    )
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

test('Bluesky link cards persist removal and convert a pasted native link into a quote draft', async ({
  identity,
  page,
}) => {
  test.setTimeout(180_000)
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page, ['bluesky'])
    await page.route('**/api/v1/content-drafts/link-card?*', (route) =>
      route.fulfill({
        json: {
          title: 'A native source post',
          description: 'A source preview',
          image: null,
          url: 'https://bsky.app/profile/example.com/post/3kabc123',
        },
      })
    )
    const original = await openNewDraft(page)
    await draftEditor(page).click()
    await page.waitForTimeout(300)
    await page.keyboard.press('ControlOrMeta+End')
    await page.waitForTimeout(150)
    await page.keyboard.type('My commentary https://bsky.app/profile/example.com/post/3kabc123')
    await expect(page.getByRole('region', { name: 'Link previews' })).toContainText(
      'A native source post'
    )
    await page.getByRole('button', { name: 'Remove preview', exact: true }).click()
    await expectSaved(page)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Restore preview', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Restore preview', exact: true }).click()
    await expectSaved(page)
    await page.getByRole('button', { name: 'Open as quote draft', exact: true }).click()
    await page.waitForURL(
      (url) => /\/write\/[a-z0-9]+/.test(url.pathname) && !url.pathname.endsWith(original)
    )
    await expect(draftEditor(page)).toContainText('My commentary')
    await page.reload()
    await expect(draftEditor(page)).toContainText('My commentary')
    await page.screenshot({ path: '.context/shots/typefully-native-quote.png', fullPage: true })
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

test('Threads and Mastodon polls retain separate provider settings after reload', async ({
  identity,
  page,
}) => {
  test.setTimeout(180_000)
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page, ['threads', 'mastodon-custom'])
    await openNewDraft(page)
    await page.getByTestId('platform-tab-threads').click()
    const editThreads = page.getByRole('button', { name: 'Edit for Threads independently' })
    if (await editThreads.isVisible()) await editThreads.click()
    await draftEditor(page).click()
    await page.waitForTimeout(300)
    await page.keyboard.press('ControlOrMeta+End')
    await page.waitForTimeout(150)
    await page.keyboard.type('Which release should ship?')
    await page.getByRole('button', { name: 'Add a poll', exact: true }).first().click()
    await page.getByRole('button', { name: 'Add poll', exact: true }).click()
    await page.getByLabel('Poll option 1', { exact: true }).fill('Alpha')
    await page.getByLabel('Poll option 2', { exact: true }).fill('Beta')
    await expect(page.getByLabel('Poll duration', { exact: true })).toContainText('1 day')
    await page.keyboard.press('Escape')
    await expectSaved(page)
    await page.getByTestId('platform-tab-mastodon').click()
    const edit = page.getByRole('button', { name: 'Edit for Mastodon independently' })
    if (await edit.isVisible()) await edit.click()
    await expect(
      page.getByRole('button', { name: /^(Edit the poll|Add a poll)$/ }).first()
    ).toBeVisible()
    const poll = page.getByRole('button', { name: 'Edit the poll', exact: true }).first()
    if (await poll.isVisible()) await poll.click()
    else {
      await page.getByRole('button', { name: 'Add a poll', exact: true }).first().click()
      await page.getByRole('button', { name: 'Add poll', exact: true }).click()
    }
    await page.getByLabel('Poll option 1', { exact: true }).fill('Alpha')
    await page.getByLabel('Poll option 2', { exact: true }).fill('Beta')
    await page.getByLabel('Allow multiple choices').check()
    await page.getByLabel('Poll duration in minutes').fill('45')
    await page.keyboard.press('Escape')
    await expectSaved(page)
    await page.reload()
    await page.getByTestId('platform-tab-mastodon').click()
    await page.getByRole('button', { name: 'Edit the poll', exact: true }).first().click()
    await expect(page.getByLabel('Allow multiple choices')).toBeChecked()
    await expect(page.getByLabel('Poll duration in minutes')).toHaveValue('45')
    await page.keyboard.press('Escape')
    await page.getByTestId('platform-tab-threads').click()
    await page.getByRole('button', { name: 'Edit the poll', exact: true }).first().click()
    await expect(page.getByLabel('Poll duration', { exact: true })).toContainText('1 day')
    await expect(page.getByLabel('Poll option 1', { exact: true })).toHaveValue('Alpha')
    await page.screenshot({ path: '.context/shots/typefully-native-polls.png', fullPage: true })
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

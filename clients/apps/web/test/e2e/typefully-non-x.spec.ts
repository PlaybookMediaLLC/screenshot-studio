import { expect } from '@playwright/test'
import {
  createDraftWorkspace,
  draftEditor,
  expectSaved,
  openNewDraft,
  type DraftWorkspace,
} from './framework/content-drafts'
import { configureE2EFlow, test } from './framework/flow'
import { apiRequest, unbindTestGoOrganization } from './framework/publishing'
import { createE2EDatabase, queryRows } from './framework/services'
configureE2EFlow()

test('finisher templates support create edit search reuse and delete in an independent Bluesky version', async ({
  identity,
  page,
}) => {
  test.setTimeout(180_000)
  let workspace: DraftWorkspace | null = null
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    workspace = await createDraftWorkspace(identity, page, ['threads', 'bluesky'])
    const id = await openNewDraft(page)
    await draftEditor(page).click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('The first post')
    await expectSaved(page)
    await page.getByTestId('platform-tab-bluesky').click()
    const fork = page.getByRole('button', { name: 'Edit for Bluesky independently' })
    if (await fork.isVisible()) await fork.click()
    await page.getByRole('button', { name: 'Closing-post templates', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Create new template' }).click()
    await dialog.getByLabel('Name', { exact: true }).fill('Follow our releases')
    await dialog.getByRole('textbox', { name: /^Text/ }).fill('Follow for more release notes')
    await expect(dialog).toContainText('29/300')
    await expect(dialog.getByRole('switch', { name: 'Quote the first post' })).toBeChecked()
    await dialog.getByRole('button', { name: 'Save finisher' }).click()
    await expect(dialog.getByTestId('finisher')).toHaveCount(1)
    await dialog.getByRole('button', { name: 'Edit', exact: true }).click()
    await dialog.getByRole('textbox', { name: /^Text/ }).fill('Follow for the next release')
    await dialog.getByRole('button', { name: 'Save finisher' }).click()
    await dialog.getByLabel('Search finishers').fill('next release')
    await expect(dialog.getByTestId('finisher')).toHaveCount(1)
    await dialog.getByRole('button', { name: 'Add to current draft' }).click()
    await expect(draftEditor(page)).toContainText('Follow for the next release')
    await expectSaved(page)
    await page.reload()
    await page.getByTestId('platform-tab-bluesky').click()
    await expect(draftEditor(page)).toContainText('Follow for the next release')
    const saved = (await apiRequest(page, `/api/v1/content-drafts/${id}`)).body as {
      body: unknown
      platformVersions: { versions: { channel: string; body?: unknown }[] }
    }
    expect(JSON.stringify(saved.body)).not.toContain('Follow for the next release')
    expect(
      JSON.stringify(
        saved.platformVersions.versions.find((item) => item.channel === 'bluesky')?.body
      )
    ).toContain('"quoteFirstPost":true')
    await page.getByRole('button', { name: 'Closing-post templates', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog.getByTestId('finisher')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click()
    await expect(draftEditor(page)).toContainText('Follow for the next release')
    await page.screenshot({ path: '.context/shots/typefully-finisher-library.png', fullPage: true })
    expect(errors).toEqual([])
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

test('LinkedIn share URLs convert into scheduled native reposts with a previewed first comment', async ({
  identity,
  page,
}) => {
  test.setTimeout(180_000)
  let workspace: DraftWorkspace | null = null
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    workspace = await createDraftWorkspace(identity, page, ['linkedin'])
    const url =
      'https://www.linkedin.com/posts/anne_release-notes-activity-7100000000000000000-Ab_c?utm_source=share'
    await page.route('**/api/v1/content-drafts/link-card?*', (route) =>
      route.fulfill({
        json: {
          title: 'Release notes from Anne',
          description: 'Native LinkedIn source',
          image: null,
          url,
        },
      })
    )
    const original = await openNewDraft(page)
    await draftEditor(page).click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type(`My perspective on this release ${url}`)
    await page.getByRole('button', { name: 'Open as quote draft', exact: true }).click()
    await page.waitForURL(
      (current) =>
        /\/write\/[a-z0-9]+/.test(current.pathname) && !current.pathname.endsWith(original)
    )
    const id = new URL(page.url()).pathname.split('/').pop()!
    await expect(draftEditor(page)).toContainText('My perspective on this release')
    await page.getByRole('button', { name: 'Add LinkedIn comment', exact: true }).click()
    await page
      .getByLabel('First comment', { exact: true })
      .fill('The guide: https://example.com/guide')
    await page.keyboard.press('Escape')
    await expectSaved(page)
    await page.reload()
    await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
    await expect(page.getByTestId('preview-linkedin')).toContainText(
      'The guide: https://example.com/guide'
    )
    await page.getByTestId('schedule-button').click()
    const dialog = page.getByTestId('schedule-dialog')
    await dialog.getByRole('button', { name: /^Tomorrow 9:00/ }).click()
    await dialog.getByLabel('Open a new draft after scheduling').uncheck()
    await dialog.getByRole('button', { name: /^Confirm schedule/ }).click()
    await expect(dialog).toHaveCount(0)
    const db = createE2EDatabase()
    try {
      const rows = await queryRows<{
        caption: string
        publishOptions: { quoteRemoteId: string; firstComment: string }
      }>(db, 'SELECT caption,"publishOptions" FROM scheduled_post WHERE "contentDraftId"=$1', [id])
      expect(rows).toHaveLength(1)
      expect(rows[0].caption).toContain('My perspective on this release')
      expect(rows[0].publishOptions.quoteRemoteId).toBe('urn:li:activity:7100000000000000000')
      expect(rows[0].publishOptions.firstComment).toBe('The guide: https://example.com/guide')
    } finally {
      await db.end()
    }
    expect(errors).toEqual([])
    await page.screenshot({
      path: '.context/shots/typefully-linkedin-repost-comment.png',
      fullPage: true,
    })
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

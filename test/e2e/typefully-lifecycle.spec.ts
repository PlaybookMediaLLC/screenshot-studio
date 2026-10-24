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

test('brand defaults survive reload and dragging a draft onto the weekly board only plans it after review', async ({
  identity,
  page,
}) => {
  test.setTimeout(180_000)
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page, ['x'])
    const oldId = await openNewDraft(page)
    const oldResponse = await apiRequest(page, `/api/v1/content-drafts/${oldId}`)
    const old = oldResponse.body as { socialSetId: string; engagement: unknown }
    await page.goto(`/workspace/social-sets/${old.socialSetId}/new-draft`)
    await page.getByRole('switch', { name: 'Auto-Retweet', exact: true }).check()
    await page.getByLabel('Auto-Retweet likes', { exact: true }).fill('7')
    await page.getByRole('switch', { name: 'Auto-Plug', exact: true }).check()
    await page.getByLabel('Auto-Plug likes', { exact: true }).fill('9')
    await page
      .getByLabel('Auto-Plug reply text', { exact: true })
      .fill('The release guide is ready')
    await page.getByRole('button', { name: 'Save engagement defaults', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Auto-Plug reply text', { exact: true })).toHaveValue(
      'The release guide is ready'
    )
    const nextId = await openNewDraft(page)
    const next = (await apiRequest(page, `/api/v1/content-drafts/${nextId}`)).body as {
      engagement: { autoRepost: { atLikes: number }; autoPlug: { text: string } }
    }
    expect(next.engagement.autoRepost.atLikes).toBe(7)
    expect(next.engagement.autoPlug.text).toBe('The release guide is ready')
    expect(
      ((await apiRequest(page, `/api/v1/content-drafts/${oldId}`)).body as { engagement: unknown })
        .engagement
    ).toEqual(old.engagement)
    await draftEditor(page).click()
    await page.waitForTimeout(300)
    await page.keyboard.press('ControlOrMeta+End')
    await page.waitForTimeout(150)
    await page.keyboard.type('Board draft for review')
    await expectSaved(page)
    await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
    const resize = page.getByRole('separator', { name: /Resize/ })
    await resize.focus()
    const width = Number(await resize.getAttribute('aria-valuenow'))
    await page.keyboard.press('ArrowLeft')
    await expect(resize).not.toHaveAttribute('aria-valuenow', String(width))
    await page.keyboard.press('ControlOrMeta+Shift+F')
    await expect(page.getByTestId('write-rail')).not.toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+F')
    const anchor = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
    await page.goto(`/write/plan?view=queue&week=${anchor}`)
    await expect(page.locator('[data-day]')).toHaveCount(7)
    const source = page
      .getByTestId('draft-row')
      .filter({ hasText: 'Board draft for review' })
      .getByRole('link')
      .first()
    await source.dragTo(page.locator('[data-day]').nth(2))
    await expect(page.getByTestId('schedule-dialog')).toBeVisible()
    let posts = await apiRequest(page, `/api/v1/content-drafts/${nextId}/posts`)
    expect(posts.status).toBe(200)
    expect((posts.body as { posts: unknown[] }).posts).toHaveLength(0)
    await page.getByRole('button', { name: 'Save as planned', exact: true }).click()
    await expect(page.getByTestId('schedule-dialog')).toHaveCount(0)
    posts = await apiRequest(page, `/api/v1/content-drafts/${nextId}/posts`)
    expect((posts.body as { posts: unknown[] }).posts).toHaveLength(0)
    await page.goto(`/write/plan?view=queue&week=${anchor}&scope=workspace`)
    await expect(page.getByTestId('calendar-planned')).toContainText('Board draft for review')
    await page.screenshot({ path: '.context/shots/typefully-weekly-board.png', fullPage: true })
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

test('X reply settings and disclosures and LinkedIn first comments persist into publication snapshots', async ({
  identity,
  page,
}) => {
  test.setTimeout(180_000)
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page)
    const id = await openNewDraft(page)
    await draftEditor(page).click()
    await page.waitForTimeout(300)
    await page.keyboard.press('ControlOrMeta+End')
    await page.waitForTimeout(150)
    await page.keyboard.type('A post with native options')
    await page.getByRole('button', { name: 'Audience and disclosures for post 1' }).click()
    await page.getByRole('combobox', { name: 'Who can reply' }).click()
    await page.getByRole('option', { name: 'Verified accounts', exact: true }).click()
    await page.getByRole('switch', { name: 'Paid partnership', exact: true }).check()
    await page.getByRole('switch', { name: 'Made with AI', exact: true }).check()
    await page.keyboard.press('Escape')
    await expectSaved(page)
    await page.getByTestId('platform-tab-linkedin').click()
    await page.getByRole('button', { name: 'Add LinkedIn comment', exact: true }).click()
    await page.getByLabel('First comment', { exact: true }).fill('Here is the first comment')
    await page.keyboard.press('Escape')
    await expectSaved(page)
    await page.reload()
    await page.getByTestId('platform-tab-linkedin').click()
    await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
    await page
      .getByTestId('preview-panel')
      .getByRole('button', { name: 'LinkedIn', exact: true })
      .click()
    await expect(page.getByTestId('preview-linkedin')).toContainText('Here is the first comment')
    await page.getByTestId('schedule-button').click()
    const dialog = page.getByTestId('schedule-dialog')
    await dialog.getByRole('button', { name: /^Tomorrow 9:00/ }).click()
    await dialog.getByLabel('Open a new draft after scheduling').uncheck()
    await dialog.getByRole('button', { name: /^Confirm schedule/ }).click()
    await expect(dialog).toHaveCount(0)
    const response = await apiRequest(page, `/api/v1/content-drafts/${id}/posts`)
    expect(response.status).toBe(200)
    expect((response.body as { posts: unknown[] }).posts).toHaveLength(2)
    const db = createE2EDatabase()
    try {
      const rows = await queryRows<{
        platform: string
        publishOptions: {
          paidPartnership?: boolean
          madeWithAi?: boolean
          replySettings?: string
          firstComment?: string
        }
      }>(
        db,
        'SELECT c.platform, p."publishOptions" FROM scheduled_post p JOIN channel_connection c ON c.id=p."channelConnectionId" WHERE p."contentDraftId"=$1',
        [id]
      )
      const x = rows.find((row) => row.platform === 'x')!.publishOptions
      expect(x.paidPartnership).toBe(true)
      expect(x.madeWithAi).toBe(true)
      expect(x.replySettings).toBe('verified')
      expect(rows.find((row) => row.platform === 'linkedin')!.publishOptions.firstComment).toBe(
        'Here is the first comment'
      )
    } finally {
      await db.end()
    }
    await page.screenshot({ path: '.context/shots/typefully-post-options.png', fullPage: true })
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

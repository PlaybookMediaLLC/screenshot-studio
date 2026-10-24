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

test('verified long-form allowance drives writing, exact manual copy and scheduling, and downgrade offers splitting', async ({
  identity,
  page,
  context,
}) => {
  test.setTimeout(180_000)
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page, ['x'])
    const db = createE2EDatabase()
    const subscription = async (premium: boolean) => {
      await db.query(
        `UPDATE "Integration" SET "verifiedCapabilities"=jsonb_set("verifiedCapabilities",'{x}',("verifiedCapabilities"->'x') || $2::jsonb) WHERE id=$1`,
        [
          `social-${workspace!.organizationId}-x`,
          JSON.stringify({
            subscriptionType: premium ? 'Premium' : 'None',
            longPostMaxWeightedCharacters: premium ? 25000 : null,
            articles: premium,
            videoMaxBytes: premium ? 16000000000 : 8000000000,
            videoMaxDurationSeconds: premium ? 7500 : 1200,
          }),
        ]
      )
    }
    try {
      await subscription(true)
      const id = await openNewDraft(page)
      await expect(page.getByLabel('Characters per post')).toHaveAttribute('max', '25000')
      const text = 'A longer post preserves every word and paragraph. '.repeat(90).trim()
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.evaluate((value) => navigator.clipboard.writeText(value), text)
      await draftEditor(page).click()
      await page.waitForTimeout(250)
      await page.keyboard.press('ControlOrMeta+End')
      await page.keyboard.press('ControlOrMeta+V')
      await expect(page.getByTestId('post-header')).toHaveCount(1)
      await expectSaved(page)
      await page.getByRole('button', { name: 'Copy text', exact: true }).click()
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text)
      await page.reload()
      await expect(draftEditor(page)).toContainText(text)
      await page.getByTestId('schedule-button').click()
      const dialog = page.getByTestId('schedule-dialog')
      await dialog.getByRole('button', { name: /^Tomorrow 9:00/ }).click()
      await dialog.getByLabel('Open a new draft after scheduling').uncheck()
      await dialog.getByRole('button', { name: /^Confirm schedule/ }).click()
      await expect(dialog).toHaveCount(0)
      const rows = await queryRows<{ caption: string }>(
        db,
        'SELECT caption FROM scheduled_post WHERE "contentDraftId"=$1',
        [id]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].caption).toBe(text)
      // The fixture changes only its local verified capability snapshot. The real
      // adapter rechecks signed users/me before any provider mutation.
      await subscription(false)
      const fresh = await openNewDraft(page)
      const record = (await apiRequest(page, `/api/v1/content-drafts/${fresh}`)).body as {
        version: number
      }
      const seeded = await apiRequest(page, `/api/v1/content-drafts/${fresh}`, {
        method: 'PATCH',
        body: { baseVersion: record.version, body: [{ type: 'p', children: [{ text }] }] },
      })
      expect(seeded.status).toBe(200)
      await page.reload()
      await expect(page.getByLabel('Characters per post')).toHaveAttribute('max', '280')
      await expect(draftEditor(page)).toContainText(text)
      await page.getByTestId('publish-button').click()
      const review = page.getByTestId('publish-review')
      await expect(review.getByRole('button', { name: 'Publish now', exact: true })).toBeDisabled()
      await expect(review).toContainText('280')
      await review.getByRole('button', { name: 'Close', exact: true }).click()
      await page.getByRole('button', { name: 'Make thread', exact: true }).click()
      await expect.poll(() => page.getByTestId('post-header').count()).toBeGreaterThan(1)
      await expectSaved(page)
      await page.reload()
      await expect.poll(() => page.getByTestId('post-header').count()).toBeGreaterThan(1)
      await page.screenshot({ path: '.context/shots/typefully-long-form.png', fullPage: true })
    } finally {
      await db.end()
    }
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

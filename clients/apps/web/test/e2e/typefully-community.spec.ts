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
import { createE2EDatabase, queryRows } from './framework/services'
configureE2EFlow()

test('community timeline choice persists through audience, publish review and schedule snapshot', async ({
  identity,
  page,
}) => {
  test.setTimeout(120_000)
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page, ['x'])
    const id = await openNewDraft(page)
    await draftEditor(page).pressSequentially('A community update.')
    await expectSaved(page)
    await page.getByRole('button', { name: 'Audience: everyone', exact: true }).click()
    const audience = page.getByRole('dialog', { name: 'Audience', exact: true })
    await audience.getByLabel('Community URL or id').fill('https://x.com/i/communities/42')
    await audience.getByLabel('Name, for your reference').fill('Builders')
    await expect(audience.getByLabel('Share to timeline')).toBeChecked()
    await audience.getByLabel('Share to timeline').uncheck()
    await audience.getByRole('button', { name: 'Post to this community' }).click()
    await expectSaved(page)
    await page.reload()
    await page.getByTestId('publish-button').click()
    const review = page.getByTestId('publish-review')
    await expect(review.getByLabel('Share to timeline')).not.toBeChecked()
    await expect(review).toContainText('remains public')
    await review.getByLabel('Share to timeline').check()
    await review.getByRole('button', { name: 'Close', exact: true }).click()
    await expectSaved(page)
    await page.reload()
    await page.getByTestId('schedule-button').click()
    const schedule = page.getByTestId('schedule-dialog')
    await expect(schedule.getByLabel('Share to timeline')).toBeChecked()
    await schedule.getByLabel('Share to timeline').uncheck()
    await schedule.getByRole('button', { name: /^Tomorrow 9:00/ }).click()
    await schedule.getByLabel('Open a new draft after scheduling').uncheck()
    await schedule.getByRole('button', { name: /^Confirm schedule/ }).click()
    await expect(schedule).toHaveCount(0)
    const db = createE2EDatabase()
    try {
      const rows = await queryRows<{
        options: { communityId: string; shareWithFollowers?: boolean }
      }>(db, 'SELECT "publishOptions" AS options FROM scheduled_post WHERE "contentDraftId"=$1', [
        id,
      ])
      expect(rows).toHaveLength(1)
      expect(rows[0].options.communityId).toBe('42')
      // Go omits a false JSON scalar, but the community identity makes it an explicit
      // no-broadcast choice in the native adapter (covered by its wire tests).
      expect(rows[0].options.shareWithFollowers ?? false).toBe(false)
    } finally {
      await db.end()
    }
    await page.screenshot({ path: '.context/shots/typefully-community.png', fullPage: true })
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

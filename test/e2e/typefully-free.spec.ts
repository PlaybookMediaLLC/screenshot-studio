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

test('free scheduling creates an explicit commitment while queue and paid capabilities stay closed', async ({
  identity,
  page,
}) => {
  test.setTimeout(120_000)
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page, ['x'], 'free')
    await page.goto('/onboarding/plan')
    await expect(page.getByRole('heading', { name: 'Free basic scheduling' })).toBeVisible()
    await page.getByRole('link', { name: 'Continue with free scheduling' }).click()
    await expect(page).toHaveURL(/\/write(?:\?|$)/)
    // Signing in lands on Home; a free workspace must reach Write, not bounce to pricing.
    for (const landing of ['/sign-in', '/home', '/']) {
      await page.goto(landing)
      await expect(page).toHaveURL(/\/write(?:\?|$)/)
    }
    const id = await openNewDraft(page)
    await draftEditor(page).pressSequentially('Free basic scheduling saves a real commitment.')
    await expectSaved(page)
    await page.getByTestId('schedule-button').click()
    const dialog = page.getByTestId('schedule-dialog')
    await expect(dialog).toContainText('10 posts per month')
    await expect(dialog.getByRole('button', { name: /Next free slot/ })).toBeDisabled()
    await expect(dialog.getByLabel('Natural posting time')).toHaveCount(0)
    await dialog.getByRole('button', { name: /^Tomorrow 9:00/ }).click()
    await dialog.getByLabel('Open a new draft after scheduling').uncheck()
    await dialog.getByRole('button', { name: /^Confirm schedule/ }).click()
    await expect(dialog).toHaveCount(0)
    await page.reload()
    await expect(draftEditor(page)).toContainText('Free basic scheduling saves a real commitment.')
    const db = createE2EDatabase()
    try {
      const rows = await queryRows<{ status: string; mode: string }>(
        db,
        'SELECT status,"scheduleMode" AS mode FROM scheduled_post WHERE "contentDraftId"=$1',
        [id]
      )
      expect(rows).toEqual([{ status: 'SCHEDULED', mode: 'explicit' }])
    } finally {
      await db.end()
    }
    const best = await apiRequest(page, '/api/v1/content-draft-queue/best-times')
    expect(best.status).toBe(403)
    const credits = await apiRequest(page, '/api/billing/credits', {
      method: 'POST',
      body: { pack: 'launch' },
    })
    expect(credits.status).toBe(403)
    const fresh = await openNewDraft(page)
    await draftEditor(page).pressSequentially('Queue requires Pro.')
    await expectSaved(page)
    const record = (await apiRequest(page, `/api/v1/content-drafts/${fresh}`)).body as {
      version: number
    }
    const queue = await apiRequest(page, `/api/v1/content-drafts/${fresh}/schedule`, {
      method: 'POST',
      body: { version: record.version, queue: true, channelConnectionIds: [workspace.channels.x] },
    })
    expect(queue.status).toBe(403)
    await page.screenshot({ path: '.context/shots/typefully-free.png', fullPage: true })
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

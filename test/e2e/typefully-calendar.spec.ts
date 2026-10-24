import { expect } from '@playwright/test'
import { createDraftWorkspace, draftEditor, type DraftWorkspace } from './framework/content-drafts'
import { configureE2EFlow, test } from './framework/flow'
import { apiRequest, unbindTestGoOrganization } from './framework/publishing'
import { createE2EDatabase, queryRows } from './framework/services'

configureE2EFlow()

test('month moves and swaps persist, failed moves stay put, and publish now requires confirmation', async ({
  identity,
  page,
}) => {
  test.setTimeout(240_000)
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page, ['x'])
    const anchor = new Date(Date.now() + 10 * 86_400_000)
    anchor.setUTCHours(10, 0, 0, 0)
    const secondAt = new Date(anchor.getTime() + 86_400_000)
    const create = async (title: string, at: Date) => {
      const made = await apiRequest(page, '/api/v1/content-drafts', {
        method: 'POST',
        body: { title, plainText: title, body: [{ type: 'p', children: [{ text: title }] }] },
      })
      expect(made.status, JSON.stringify(made.body)).toBe(201)
      const draft = made.body as { id: string; version: number }
      const scheduled = await apiRequest(page, `/api/v1/content-drafts/${draft.id}/schedule`, {
        method: 'POST',
        body: {
          channelConnectionIds: [workspace!.channels.x],
          version: draft.version,
          scheduledFor: at.toISOString(),
        },
      })
      expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(201)
      return draft.id
    }
    const one = await create('Calendar first', anchor)
    const two = await create('Calendar second', secondAt)
    const day = (at: Date) => page.locator(`[data-day="${at.toISOString().slice(0, 10)}"]`)
    const card = (text: string) => page.getByTestId('calendar-post').filter({ hasText: text })
    await page.goto(`/write/plan?view=month&week=${anchor.toISOString().slice(0, 10)}`)
    await expect(page.locator('[data-day]')).toHaveCount(42)
    await expect(day(anchor)).toContainText('Calendar first')
    await expect(day(secondAt)).toContainText('Calendar second')
    const swapped = page.waitForResponse(
      (response) => response.url().endsWith('/swap') && response.request().method() === 'POST',
      { timeout: 20_000 }
    )
    await card('Calendar first').dragTo(card('Calendar second'))
    expect((await swapped).ok()).toBeTruthy()
    await expect(day(secondAt)).toContainText('Calendar first')
    await expect(day(anchor)).toContainText('Calendar second')

    // An uncertain/failed network response never claims an uncommitted slot.
    await page.route('**/content-draft-posts/*/move', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Move unavailable' }),
      })
    )
    const later = new Date(secondAt.getTime() + 86_400_000)
    await card('Calendar first').dragTo(day(later))
    await expect(page.getByText('Move unavailable')).toBeVisible()
    await expect(day(secondAt)).toContainText('Calendar first')
    await page.unroute('**/content-draft-posts/*/move')

    // The same backend operation is accessible without dragging.
    await page.getByRole('button', { name: 'Move Calendar first', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Day', { exact: true }).fill(later.toISOString().slice(0, 10))
    await dialog.getByLabel('Time', { exact: true }).fill('13:15')
    await dialog.getByRole('button', { name: 'Confirm move' }).click()
    await expect(day(later)).toContainText('Calendar first')
    await page.reload()
    await expect(day(later)).toContainText('Calendar first')
    await page.screenshot({ path: '.context/shots/typefully-month.png', fullPage: true })

    await page.goto(`/write/${one}`)
    const queued = page
      .getByTestId('draft-post')
      .filter({ has: page.getByRole('button', { name: 'Publish now', exact: true }) })
    await queued.getByRole('button', { name: 'Publish now', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toContainText('Later draft edits are not included')
    await page.getByRole('button', { name: 'Keep scheduled' }).click()
    await queued.getByRole('button', { name: 'Publish now', exact: true }).click()
    const publishing = page.waitForResponse(
      (response) =>
        response.url().endsWith('/publish-now') && response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: 'Confirm publish now' }).click()
    const response = await publishing
    expect(response.ok(), await response.text()).toBeTruthy()
    const successor = (await response.json()) as { post: { id: string; scheduledFor: string } }
    expect(new Date(successor.post.scheduledFor).getTime()).toBeLessThanOrEqual(Date.now())
    const db = createE2EDatabase()
    try {
      const rows = await queryRows<{ id: string; status: string }>(
        db,
        'SELECT id,status FROM scheduled_post WHERE "contentDraftId"=$1 AND status<>\'CANCELLED\'',
        [one]
      )
      expect(rows.map((row) => row.id)).toEqual([successor.post.id])
      const other = await queryRows<{ status: string }>(
        db,
        'SELECT status FROM scheduled_post WHERE "contentDraftId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
        [two]
      )
      expect(other[0].status).toBe('SCHEDULED')
      const past = new Date(Date.now() - 86_400_000)
      past.setUTCHours(15, 0, 0, 0)
      // A confirmed provider receipt is seeded; no real network is published to.
      await db.query(
        'UPDATE scheduled_post SET status=\'PUBLISHED\', "remotePostId"=\'123456789\', "scheduledFor"=$2, metrics=$3, "metricsAt"=now() WHERE "contentDraftId"=$1 AND status=\'SCHEDULED\'',
        [two, past, { likes: 12, replies: 3 }]
      )
      await page.goto(`/write/plan?view=month&week=${anchor.toISOString().slice(0, 10)}`)
      await day(anchor).getByRole('button', { name: 'Pick', exact: true }).first().click()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Calendar second', exact: true })
        .click()
      await page.waitForURL(/\/write\/[a-z0-9]+\?.*panel=schedule/)
      const copiedId = new URL(page.url()).pathname.split('/').pop()!
      expect(copiedId).not.toBe(two)
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
      await expect(draftEditor(page)).toContainText('Calendar second')
      const copied = await queryRows<{ count: string }>(
        db,
        'SELECT count(*)::text FROM scheduled_post WHERE "contentDraftId"=$1',
        [copiedId]
      )
      expect(copied[0].count).toBe('0')
      await page.goto('/write/analyze')
      await expect(page.getByTestId('posting-times')).toContainText('1 measured posts')
      const weekday = past.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
      await page.getByRole('button', { name: `Add ${weekday} suggested slot` }).click()
      await expect(page.getByText(`Added ${weekday} at 15:00`, { exact: false })).toBeVisible()
      await page.reload()
      await expect(page.getByRole('button', { name: `Add ${weekday} suggested slot` })).toHaveText(
        'Added'
      )
      await page.screenshot({ path: '.context/shots/typefully-posting-times.png', fullPage: true })
    } finally {
      await db.end()
    }
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

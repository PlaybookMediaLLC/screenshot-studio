import { randomUUID } from 'node:crypto'
import { configureE2EFlow, expect, test } from './framework/flow'
import { signUpViaApi } from './framework/auth'
import { browserJson } from './framework/browser'
import { createE2EDatabase, grantWorkspacePlan } from './framework/services'

configureE2EFlow()

test('notification history changes only through explicit actions and stays synchronized', async ({
  page,
  identity,
}) => {
  test.setTimeout(180_000)
  await signUpViaApi(identity, page)
  const workspace = (await browserJson(page, '/api/auth/organization/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: identity.workspaceName, slug: `inbox-${randomUUID()}` }),
  })) as { id: string }
  await grantWorkspacePlan(workspace.id, 'pro')
  const session = (await browserJson(page, '/api/auth/get-session')) as { user: { id: string } }
  const database = createE2EDatabase()
  const campaign = randomUUID()
  const ids = Array.from({ length: 105 }, () => randomUUID())
  try {
    await database.query(
      `INSERT INTO campaign(id,"organizationId",name,objective,"createdByUserId","updatedAt") VALUES($1,$2,'Autumn launch','Launch',$3,now())`,
      [campaign, workspace.id, session.user.id]
    )
    // Recipient fixtures use real storage, authentication, authorization, and endpoints.
    for (const [index, id] of ids.entries()) {
      const kind =
        index === 0
          ? 'generation.failed'
          : index === 1
            ? 'campaign_posts.submitted'
            : 'generation.completed'
      const description =
        index === 0
          ? 'Generation needs attention'
          : index === 1
            ? 'Campaign posts need review'
            : 'Generation finished'
      await database.query(
        `INSERT INTO platform_notification_inbox(id,"organizationId","userId",event_id,kind,resource_type,resource_id,description,href,created_at) VALUES($1,$2,$3,$1,$4,'campaign',$5,$6,$7,now()-($8 * interval '1 minute'))`,
        [
          id,
          workspace.id,
          session.user.id,
          kind,
          campaign,
          description,
          `/campaigns/${campaign}/copy`,
          index,
        ]
      )
    }
    const unseen = async () =>
      Number(
        (
          await database.query(
            `SELECT count(*) n FROM platform_notification_inbox WHERE "organizationId"=$1 AND "userId"=$2 AND seen_at IS NULL`,
            [workspace.id, session.user.id]
          )
        ).rows[0].n
      )
    const retained = async () =>
      Number(
        (
          await database.query(
            `SELECT count(*) n FROM platform_notification_inbox WHERE "organizationId"=$1 AND "userId"=$2`,
            [workspace.id, session.user.id]
          )
        ).rows[0].n
      )
    const seenIDs = async () =>
      (
        await database.query(
          `SELECT id FROM platform_notification_inbox WHERE "organizationId"=$1 AND "userId"=$2 AND seen_at IS NOT NULL ORDER BY id`,
          [workspace.id, session.user.id]
        )
      ).rows.map((row) => row.id)
    await page.goto('/workspace/notifications')
    const bell = page
      .getByRole('button', { name: 'Notifications, 99+ unseen', exact: true })
      .first()
    await expect(bell).toBeVisible()
    const peer = await page.context().newPage()
    await peer.goto('/workspace/notifications')
    await page.bringToFront()
    let writes = 0
    page.on('request', (request) => {
      if (
        request.url().includes('/api/workspace/notifications') &&
        ['POST', 'PATCH', 'DELETE'].includes(request.method())
      )
        writes++
    })
    await bell.click()
    const inbox = page.getByRole('dialog', { name: 'Notifications' })
    const first = inbox.locator(`[data-notification-id="${ids[0]}"]`)
    await expect(first).toBeVisible()
    await expect
      .poll(() => inbox.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true)
    await expect(first).toContainText('Autumn launch')
    await inbox.getByRole('button', { name: 'Load older activity' }).scrollIntoViewIfNeeded()
    await page.keyboard.press('Escape')
    await expect(bell).toBeFocused()
    expect(await unseen()).toBe(105)
    expect(await retained()).toBe(105)
    expect(writes).toBe(0)
    await bell.click()
    await page.route(
      `**/api/workspace/notifications/items/${ids[0]}`,
      (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"Temporary notification failure"}',
        }),
      { times: 1 }
    )
    await first.getByRole('button', { name: 'Mark as seen', exact: true }).click()
    await expect(inbox.getByRole('alert')).toHaveText('Temporary notification failure')
    expect(await unseen()).toBe(105)
    expect(await retained()).toBe(105)
    await first.getByRole('button', { name: 'Mark as seen', exact: true }).click()
    await expect.poll(unseen).toBe(104)
    expect(await seenIDs()).toEqual([ids[0]])
    await expect(first.getByRole('button', { name: 'Mark as unseen' })).toBeVisible()
    await inbox.getByRole('button', { name: 'Unseen (104)' }).click()
    await expect(first).toHaveCount(0)
    await inbox.getByRole('button', { name: 'All', exact: true }).click()
    await expect(first).toBeVisible()
    await first.getByRole('button', { name: 'Mark as unseen' }).click()
    await expect.poll(unseen).toBe(105)
    await inbox.getByRole('button', { name: 'Mark all as seen' }).click()
    await expect.poll(unseen).toBe(0)
    await expect(
      peer.getByRole('button', { name: 'Notifications, 0 unseen' }).first()
    ).toBeVisible()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(unseen).toBe(105)
    expect(await seenIDs()).toEqual([])
    await expect(
      peer.getByRole('button', { name: 'Notifications, 99+ unseen' }).first()
    ).toBeVisible()
    await inbox.locator('summary').first().click()
    await expect(inbox.locator(`[data-notification-id="${ids[2]}"]`)).toBeVisible()
    await inbox.getByRole('button', { name: 'Load older activity' }).click()
    await expect(inbox.locator(`[data-notification-id="${ids[20]}"]`)).toBeAttached()
    await page.keyboard.press('Escape')
    await bell.click()
    expect(await unseen()).toBe(105)
    await first
      .getByRole('button', { name: /Open activity/ })
      .first()
      .click()
    await expect(page).toHaveURL(new RegExp(`/campaigns/${campaign}/copy`))
    await expect.poll(unseen).toBe(104)
    expect(await seenIDs()).toEqual([ids[0]])
    expect(await retained()).toBe(105)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/workspace/notifications')
    await page
      .getByRole('button', { name: /^Notifications/ })
      .filter({ visible: true })
      .click()
    await expect(first).toBeVisible()
    expect(await inbox.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.keyboard.press('Escape')
    expect(await unseen()).toBe(104)
    await peer.close()
  } finally {
    await database.end()
  }
})

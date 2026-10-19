import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { z } from 'zod'
import { configureE2EFlow, expect, test } from './framework/flow'
import { signUpViaApi } from './framework/auth'
import { browserJson, browserRequest, requestJson } from './framework/browser'
import { createE2EDatabase, grantWorkspacePlan } from './framework/services'
import { notificationPageSchema, notificationSettingsSchema } from '../../lib/notifications/schema'

configureE2EFlow()
// Headless Chromium keeps every tab focused, which cannot verify acknowledgment on real focus.
test.use({ headless: false })

test('workspace activity goes through controlled providers and deletes only seen recipient rows', async ({
  browser,
  identity,
  page,
}) => {
  test.setTimeout(300_000)
  test.skip(
    !process.env.NOTIFICATIONS_E2E_PROVIDER_URL,
    'Start the isolated notification provider fixture and e2e Go binaries.'
  )
  const database = createE2EDatabase()
  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()
  const provider = process.env.NOTIFICATIONS_E2E_PROVIDER_URL!
  const sink = async () =>
    z
      .object({
        slack: z.array(z.record(z.string(), z.unknown())),
        email: z.array(z.record(z.string(), z.unknown())),
        auth: z.array(z.object({ to: z.string(), text: z.string() })),
        channelPages: z.array(z.string()),
      })
      .parse(await (await fetch(`${provider}/sink`, { headers: { connection: 'close' } })).json())
  const dispatch = () =>
    execFileSync(
      'docker',
      [
        'exec',
        process.env.NOTIFICATIONS_E2E_TEMPORAL_CONTAINER ?? 'riga-notifications-temporal',
        'temporal',
        'workflow',
        'execute',
        '--type',
        'platform-maintenance-v1',
        '--task-queue',
        'platform-maintenance',
        '--workflow-id',
        `notification-e2e-${randomUUID()}`,
        '--input',
        '"notifications"',
      ],
      { stdio: 'pipe', timeout: 30_000 }
    )
  try {
    await signUpViaApi(identity, page)
    const workspace = z.object({ id: z.string() }).parse(
      await browserJson(page, '/api/auth/organization/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: identity.workspaceName,
          slug: `notifications-${randomUUID()}`,
        }),
      })
    )
    await grantWorkspacePlan(workspace.id, 'pro')
    const session = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await browserJson(page, '/api/auth/get-session'))
    await requestJson(page, '/api/auth/send-verification-email', {
      email: identity.email,
      callbackURL: '/workspace/notifications',
    })
    await expect
      .poll(async () =>
        (await sink()).auth.some(
          (mail) => mail.to === identity.email && mail.text.includes('/verify-email')
        )
      )
      .toBe(true)
    const verification = (await sink()).auth.find(
      (mail) => mail.to === identity.email && mail.text.includes('/verify-email')
    )!
    const verificationURL = verification.text.match(
      /http:\/\/localhost:3460\/api\/auth\/verify-email\?[^\s<>]+/
    )?.[0]
    expect(verificationURL).toBeTruthy()
    await page.goto(verificationURL!)

    const colleague = {
      ...identity,
      email: `colleague-${identity.email}`,
      name: 'Activity colleague',
    }
    await signUpViaApi(colleague, otherPage)
    const otherWorkspace = z.object({ id: z.string() }).parse(
      await browserJson(otherPage, '/api/auth/organization/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Separate activity workspace',
          slug: `separate-${randomUUID()}`,
        }),
      })
    )
    await grantWorkspacePlan(otherWorkspace.id, 'pro')
    const invitation = await requestJson(page, '/api/auth/organization/invite-member', {
      email: colleague.email,
      role: 'admin',
      organizationId: workspace.id,
    })
    expect(invitation.status, JSON.stringify(invitation.body)).toBe(200)
    const invitationID = z.object({ id: z.string() }).parse(invitation.body).id
    expect(
      (
        await requestJson(otherPage, '/api/auth/organization/accept-invitation', {
          invitationId: invitationID,
        })
      ).status
    ).toBe(200)
    expect(
      (
        await requestJson(otherPage, '/api/auth/organization/set-active', {
          organizationId: workspace.id,
        })
      ).status
    ).toBe(200)

    await page.goto('/workspace/notifications')
    await page.getByRole('button', { name: 'Connect Slack', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Local Slack fixture' })).toBeVisible()
    await page.getByRole('link', { name: 'Allow selected workspace' }).click()
    await expect(page.getByLabel('Slack workspace')).toBeVisible()
    await page.getByLabel('Slack workspace').selectOption({ label: 'Fixture team · T012345' })
    await page.getByLabel('Slack channel').selectOption('C012345')
    expect((await sink()).channelPages).toContain('page-two')
    const workspaceEmail = page.getByLabel('Source connected: workspace email', { exact: true })
    await workspaceEmail.locator('xpath=ancestor::details').locator('summary').click()
    await workspaceEmail.check()
    await page.getByLabel('Source connected: workspace slack', { exact: true }).check()
    await page.getByRole('button', { name: 'Save workspace policy' }).click()
    await expect(page.getByText('Workspace policy saved.')).toBeVisible()
    await page.getByRole('button', { name: 'Send test to my email' }).click()
    await expect(page.getByText('Test queued. Its status appears below.')).toBeVisible()
    dispatch()
    await expect(page.getByText('Test delivered.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Send test to selected channel' }).click()
    await expect(page.getByText('Test queued. Its status appears below.')).toBeVisible()
    dispatch()
    await expect.poll(async () => (await sink()).slack.length).toBeGreaterThan(0)

    const createSource = async (name: string) => {
      const response = await requestJson(otherPage, '/api/v1/source-apps', {
        name,
        allowedHosts: ['https://example.test'],
        provider: 'generic',
      })
      expect(response.status, JSON.stringify(response.body)).toBe(201)
    }
    for (let index = 0; index < 12; index++) await createSource(`Activity source ${index}`)
    await expect
      .poll(
        async () => {
          dispatch()
          return (await sink()).slack.filter(
            (message) =>
              String(message.text).includes(identity.workspaceName) &&
              String(message.text).includes('Source connected')
          ).length
        },
        { timeout: 60_000, intervals: [1200] }
      )
      .toBe(12)
    const inboxCount = async () =>
      Number(
        (
          await database.query(
            'SELECT count(*) AS n FROM platform_notification_inbox WHERE "organizationId"=$1 AND "userId"=$2 AND kind=$3',
            [workspace.id, session.user.id, 'source_app.connected']
          )
        ).rows[0].n
      )
    expect(await inboxCount()).toBe(12)
    for (const path of ['/count', '/inbox', '/count'])
      await browserJson(page, `/api/workspace/notifications${path}`)
    expect(await inboxCount()).toBe(12)
    const colleagueInbox = notificationPageSchema.parse(
      await browserJson(otherPage, '/api/workspace/notifications/inbox')
    )
    expect(
      colleagueInbox.items.filter((item) => item.kind === 'source_app.connected')
    ).toHaveLength(0)
    const delivered = await sink()
    expect(
      delivered.email.filter(
        (mail) =>
          mail.subject === 'Source connected' && JSON.stringify(mail.to).includes(identity.email)
      )
    ).toHaveLength(12)
    expect(
      delivered.slack.filter(
        (message) =>
          String(message.text).includes(identity.workspaceName) &&
          String(message.text).includes('Source connected')
      )
    ).toHaveLength(12)
    expect(JSON.stringify(delivered.slack)).not.toContain('Activity source')

    const peer = await page.context().newPage()
    await peer.goto('/workspace/notifications')
    await expect(
      peer.getByRole('button', { name: /^Notifications, \d+ unseen$/ }).first()
    ).toBeVisible()
    await page.bringToFront()

    let failedAck = false
    await page.route('**/api/workspace/notifications/seen', async (route) => {
      if (!failedAck) {
        failedAck = true
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"Fixture interruption"}',
        })
        return
      }
      await route.continue()
    })
    const background = await page.context().newPage()
    await background.goto('about:blank')
    await page.bringToFront()
    let showInbox!: () => void
    const inboxGate = new Promise<void>((resolve) => {
      showInbox = resolve
    })
    await page.route('**/api/workspace/notifications/inbox?*', async (route) => {
      await inboxGate
      await route.continue()
    })
    await page
      .getByRole('button', { name: /^Notifications/ })
      .first()
      .click()
    const inbox = page.getByRole('dialog', { name: 'Notifications' })
    const focus = await page.context().newCDPSession(page)
    // Playwright forces focus on every page; disable that override for the background-tab check.
    await focus.send('Emulation.setFocusEmulationEnabled', { enabled: false })
    await background.bringToFront()
    showInbox()
    await expect(inbox.locator('[data-notification-id]').first()).toBeAttached()
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false)
    await page.waitForTimeout(700)
    expect(await inboxCount()).toBe(12)
    await page.unroute('**/api/workspace/notifications/inbox?*')
    await background.close()
    await focus.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.bringToFront()
    await expect.poll(inboxCount).toBeLessThan(12)
    expect(await inboxCount()).toBeGreaterThan(0)
    await expect.poll(() => failedAck).toBe(true)
    const firstID = await inbox
      .locator('[data-notification-id]')
      .first()
      .getAttribute('data-notification-id')
    await expect
      .poll(async () =>
        Number(
          (
            await database.query(
              'SELECT count(*) AS n FROM platform_notification_inbox WHERE id=$1',
              [firstID]
            )
          ).rows[0].n
        )
      )
      .toBe(0)
    await expect(inbox.locator(`[data-notification-id="${firstID}"]`)).toBeVisible()
    await page.screenshot({ path: '.context/workspace-notifications.png', fullPage: false })
    await page.keyboard.press('Escape')
    await page
      .getByRole('button', { name: /^Notifications/ })
      .first()
      .click()
    await expect(inbox.locator(`[data-notification-id="${firstID}"]`)).toHaveCount(0)
    await inbox.getByRole('button', { name: 'Mark all seen' }).click()
    await expect.poll(inboxCount).toBe(0)
    await expect(
      peer.getByRole('button', { name: 'Notifications', exact: true }).first()
    ).toBeVisible()
    await peer.close()
    await page.keyboard.press('Escape')
    await page
      .getByRole('button', { name: /^Notifications/ })
      .first()
      .click()
    await expect(inbox.getByText('You’re all caught up.')).toBeVisible()
    await page.keyboard.press('Escape')
    await focus.detach()

    const personalEmail = page.getByLabel('Source connected: your email preference', {
      exact: true,
    })
    await personalEmail.locator('xpath=ancestor::details').locator('summary').click()
    await personalEmail.uncheck()
    await page.getByRole('button', { name: 'Save my preferences' }).click()
    await expect(page.getByText('Your preferences are saved.')).toBeVisible()
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await expect(page.getByText('No Slack workspace is connected.')).toBeVisible()
    const before = await sink()
    await createSource('After opt-out and disconnect')
    dispatch()
    expect(await inboxCount()).toBe(1)
    const after = await sink()
    expect(after.email.length).toBe(before.email.length)
    expect(after.slack.length).toBe(before.slack.length)
    expect(
      notificationSettingsSchema.parse(await browserJson(page, '/api/workspace/notifications'))
        .connections
    ).toHaveLength(0)

    expect(
      (
        await requestJson(otherPage, '/api/auth/organization/set-active', {
          organizationId: otherWorkspace.id,
        })
      ).status
    ).toBe(200)
    expect(
      (
        await browserRequest(otherPage, '/api/workspace/notifications/inbox', {
          headers: { 'x-notification-workspace': workspace.id },
        })
      ).status
    ).toBe(403)
    expect(
      notificationPageSchema.parse(
        await browserJson(otherPage, '/api/workspace/notifications/inbox')
      ).items
    ).toHaveLength(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await page
      .getByRole('button', { name: /^Notifications/ })
      .filter({ visible: true })
      .click()
    await expect(inbox).toBeVisible()
    await expect.poll(inboxCount).toBe(0)
    await page.screenshot({ path: '.context/workspace-notifications-mobile.png' })
  } finally {
    await otherContext.close()
    await database.end()
  }
})

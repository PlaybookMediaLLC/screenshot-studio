import { createHmac, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { configureE2EFlow, expect, test } from './framework/flow'
import { enableTwoFactor, openWorkspaceSetting, signUpAndCreateWorkspace } from './framework/auth'
import { browserRequest, chooseOption } from './framework/browser'
import { trpcMutation, trpcQuery } from './framework/trpc'
import { createE2EDatabase, queryRows } from './framework/services'
import { bindTestGoOrganization, unbindTestGoOrganization } from './framework/publishing'
import { startHttpMockServer } from './framework/http-server'

configureE2EFlow()

// This suite needs the local GitHub protocol fixture and a real Temporal
// worker. It never connects to a customer's GitHub account or social provider.
test('connects GitHub, edits and tests a workflow, then creates reviewable drafts through Temporal', async ({
  identity,
  page,
}, testInfo) => {
  test.skip(
    process.env.E2E_RELEASE_AUTOMATION !== '1',
    'Run the documented release automation fixture stack.'
  )
  test.setTimeout(240_000)
  const organizationId = await signUpAndCreateWorkspace(identity, page)
  const database = createE2EDatabase()
  const destinationId = `automation-fixture-${randomUUID()}`
  const provider = await startHttpMockServer(
    (request) => {
      if (request.url === '/api/public/v1/me')
        return { body: { organization: { id: `go-${organizationId}` } } }
      if (request.url === '/api/public/v1/integrations')
        return { body: [{ id: destinationId, identifier: 'x', disabled: false }] }
      return { status: 404, body: { error: 'No publishing operations in this fixture.' } }
    },
    Number(process.env.E2E_SOCIAL_PORT ?? 8049)
  )
  try {
    await enableTwoFactor(page, identity.password)
    await bindTestGoOrganization(page)
    const brand = await trpcMutation(page, 'brandKit.create', {
      name: 'Release fixture brand',
      publish: true,
      definition: {
        schemaVersion: 1,
        colors: { text: '#111111', background: '#ffffff', accent: '#ff0000' },
        typography: { headingFamily: 'inter' },
      },
    })
    expect(brand.status, JSON.stringify(brand.body)).toBe(200)
    const destination = await trpcMutation(page, 'channelConnection.create', {
      externalAccountId: destinationId,
      platform: 'x',
      providerSettings: {},
      secretReference: 'SOCIAL_API_KEY_E2E',
    })
    expect(destination.status, JSON.stringify(destination.body)).toBe(200)

    await openWorkspaceSetting(page, 'Release automation')
    await page.getByRole('link', { name: 'Connect GitHub', exact: true }).click()
    await expect(page.getByText('GitHub is connected. Choose a repository to watch.')).toBeVisible({
      timeout: 60_000,
    })
    await page.getByRole('button', { name: 'Choose a repository' }).click()
    await chooseOption(
      page
        .locator('form')
        .filter({ has: page.getByRole('button', { name: 'Watch', exact: true }) })
        .getByRole('combobox', { name: 'Repository', exact: true }),
      'fixture/product'
    )
    await page.getByRole('button', { name: 'Watch', exact: true }).click()
    await expect(page.getByText(/Watching fixture\/product/)).toBeVisible()
    await openWorkspaceSetting(page, 'Release automation')
    await chooseOption(
      page
        .getByRole('region', { name: 'Release workflows' })
        .getByRole('combobox', { name: 'Repository', exact: true }),
      'fixture/product'
    )
    await page.getByRole('button', { name: 'Create workflow', exact: true }).click()
    await page.getByLabel('Definition name').fill('Stable releases to review')
    const editor = page.getByRole('dialog', { name: 'Workflow editor', exact: true })
    await expect(editor).toBeVisible()
    await expect.poll(async () => Math.round((await editor.boundingBox())?.y ?? -1)).toBe(16)
    const bounds = await editor.boundingBox()
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(720)
    await page.getByRole('button', { name: 'Close editor', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toContainText('Discard unsaved changes?')
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page.getByLabel('Definition name')).toHaveValue('Stable releases to review')
    await page.getByRole('tab', { name: 'Workflow', exact: true }).click()
    await expect(page.getByLabel('Qualification field', { exact: true })).toHaveText('release.tag')
    await page.getByRole('tab', { name: 'Node', exact: true }).click()
    await page.getByRole('group', { name: 'condition: condition', exact: true }).click()
    await expect(page.getByLabel('Configure node')).toHaveText('If / then / else · condition')
    await expect(page.getByLabel('condition false connection')).toHaveText('Skip this event · skip')

    // Author through the labeled canvas controls, including an invalid draft.
    await chooseOption(page.getByLabel('Configure node'), 'Create campaign drafts · campaign')
    await chooseOption(page.getByLabel('Input from action'), 'Choose an output')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(
      page.getByText('Draft saved with validation errors. Activation is blocked.')
    ).toBeVisible()
    await chooseOption(page.getByLabel('Input from action'), 'release.releaseId')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByText('Draft saved and validated by the backend.')).toBeVisible()
    await page.getByRole('group', { name: 'condition: condition', exact: true }).press('Enter')
    await expect(page.getByLabel('Configure node')).toHaveText('If / then / else · condition')
    await page.getByRole('group', { name: 'condition: condition', exact: true }).press('ArrowRight')
    await expect(page.getByText('Unsaved', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Test draft', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Preview: completed', exact: true })
    ).toBeVisible()
    await expect(page.getByLabel('Workflow canvas').getByLabel('On preview path')).toHaveCount(6)
    await page.getByRole('button', { name: /Create campaign drafts Predicted action/ }).click()
    await expect(page.getByRole('tab', { name: 'Node', exact: true })).toHaveAttribute(
      'data-state',
      'active'
    )
    await expect(page.getByLabel('Configure node')).toHaveText('Create campaign drafts · campaign')
    await page.getByRole('tab', { name: 'Test', exact: true }).click()
    await chooseOption(page.getByLabel('Test evidence'), 'Example: else / no-match event')
    await expect(page.getByLabel('Workflow canvas').getByLabel('On preview path')).toHaveCount(0)
    await page.getByRole('button', { name: 'Test draft', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Preview: skipped', exact: true })).toBeVisible()

    await expect(page.getByLabel('Workflow canvas').getByLabel('On preview path')).toHaveCount(3)
    await page.screenshot({
      path: '.context/release-automation-preview-refined.png',
      fullPage: false,
    })
    await page.getByRole('tab', { name: 'Node', exact: true }).click()
    await chooseOption(page.getByLabel('Configure node'), 'If / then / else · condition')
    await chooseOption(page.getByLabel('Node condition operator'), 'Is true')
    await page.getByRole('tab', { name: 'Test', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Preview: skipped', exact: true })).toHaveCount(
      0
    )
    await page.getByRole('tab', { name: 'Node', exact: true }).click()
    await chooseOption(page.getByLabel('Node condition operator'), 'Is false')

    const before = await queryRows(database, 'SELECT id FROM release WHERE "organizationId"=$1', [
      organizationId,
    ])
    expect(before).toHaveLength(0)
    await expect(page.getByRole('button', { name: 'Activate version', exact: true })).toBeEnabled({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: 'Activate version', exact: true }).click()
    await expect(
      page.getByText(
        'Version activated for future events. Previously accepted events retain their versions.'
      )
    ).toBeVisible()
    await page.screenshot({
      path: '.context/release-automation-editor-refined.png',
      fullPage: false,
    })
    await page.getByLabel('Node condition operator').click()
    await page.screenshot({
      path: '.context/ui-migration-workflow-select.png',
      animations: 'disabled',
    })
    await page.keyboard.press('Escape')
    // The inspector stacks below the canvas on small screens; actions remain reachable.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(async () => Math.round((await editor.boundingBox())?.y ?? -1)).toBe(0)
    const mobileBounds = await editor.boundingBox()
    expect(mobileBounds?.width).toBeLessThanOrEqual(390)
    expect(mobileBounds?.height).toBeLessThanOrEqual(844)
    await page.getByRole('button', { name: 'Fit View', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeInViewport()
    await expect(page.getByRole('tab', { name: 'Workflow', exact: true })).toBeInViewport()
    await page.screenshot({
      path: '.context/release-automation-editor-mobile.png',
      fullPage: false,
    })
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.getByLabel('Definition name').fill('An edit to discard')
    await page.getByRole('button', { name: 'Close editor', exact: true }).click()
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await page.getByRole('button', { name: 'Edit Stable releases to review', exact: true }).click()
    await expect(page.getByLabel('Definition name')).toHaveValue('Stable releases to review')
    await page.getByRole('button', { name: 'Close editor', exact: true }).click()

    const title = `Fixture release ${randomUUID().slice(0, 8)}`
    const releaseId = Date.now()
    const payload = (id: number, prerelease: boolean) => ({
      action: 'published',
      installation: { id: 77 },
      sender: { login: 'fixture-author' },
      repository: { id: 1001, full_name: 'fixture/product', default_branch: 'main' },
      release: {
        id,
        name: prerelease ? `${title} prerelease` : title,
        tag_name: `v${id}`,
        body: 'Faster, reliable exports.',
        prerelease,
        draft: false,
        published_at: new Date().toISOString(),
        html_url: `https://github.com/fixture/product/releases/tag/v${id}`,
      },
    })
    const secret = process.env.E2E_GITHUB_WEBHOOK_SECRET
    if (!secret) throw new Error('E2E_GITHUB_WEBHOOK_SECRET is required.')
    const deliver = (
      body: string,
      event = 'release',
      signature?: string,
      delivery = randomUUID()
    ) =>
      browserRequest(page, '/api/webhooks/github', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'x-github-event': event,
          'x-github-delivery': delivery,
          'x-hub-signature-256':
            signature ?? `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
        },
      })
    const body = JSON.stringify(payload(releaseId, false))
    expect((await deliver(body, 'release', 'sha256=invalid')).status).toBe(401)
    expect((await deliver('{')).status).toBe(400)
    expect((await deliver(JSON.stringify({}), 'push')).status).toBe(202)
    const delivery = randomUUID()
    expect((await deliver(body, 'release', undefined, delivery)).status).toBe(200)
    expect((await deliver(body, 'release', undefined, delivery)).status).toBe(202)
    expect((await deliver(body)).status).toBe(202)

    const historyRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: title, exact: true }) })
    await expect(historyRow).toContainText('succeeded', { timeout: 90_000 })
    await historyRow.getByRole('button', { name: title, exact: true }).click()
    await expect(page.getByRole('link', { name: 'Open release', exact: true })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Open campaign drafts', exact: true })
    ).toBeVisible()
    await expect(
      page.locator('[aria-label="Run details"]').getByText(/Drafts submitted for human review/)
    ).toBeVisible()
    const releases = await queryRows(database, 'SELECT id FROM release WHERE "organizationId"=$1', [
      organizationId,
    ])
    const posts = await queryRows(
      database,
      'SELECT id,status FROM campaign_post WHERE "organizationId"=$1',
      [organizationId]
    )
    expect(releases).toHaveLength(1)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.status).toBe('READY_FOR_REVIEW')
    const history = z
      .object({
        items: z.array(
          z.object({
            run: z.object({ workflowId: z.string().min(1), temporalRunId: z.string().uuid() }),
          })
        ),
      })
      .parse((await trpcQuery(page, 'releaseAutomation.history')).body)
    expect(history.items).toHaveLength(1)

    await page.screenshot({ path: '.context/release-automation-success.png', fullPage: true })
    await page.getByRole('link', { name: 'Open release', exact: true }).click()
    await expect(page).toHaveURL(/\/releases\/[a-f0-9-]+$/)
    await expect(page.getByRole('heading', { name: title, level: 1, exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Release automation', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Release automation', level: 2, exact: true })
    ).toBeVisible()
    expect((await deliver(JSON.stringify(payload(releaseId + 1, true)))).status).toBe(200)
    const skipped = page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: `${title} prerelease`, exact: true }) })
    await expect(skipped).toContainText('skipped', { timeout: 60_000 })
    expect(
      await queryRows(database, 'SELECT id FROM release WHERE "organizationId"=$1', [
        organizationId,
      ])
    ).toHaveLength(1)
    await skipped.getByRole('button', { name: `${title} prerelease`, exact: true }).click()
    await expect(page.getByText(/condition · completed/)).toBeVisible()
    await page.screenshot({ path: '.context/release-automation-history.png', fullPage: true })
    await testInfo.attach('release-automation-history', {
      path: '.context/release-automation-history.png',
      contentType: 'image/png',
    })

    await page.getByRole('button', { name: 'Stop watching fixture/product', exact: true }).click()
    await expect(page.getByText(/Repository access removed or no longer watched/)).toBeVisible()
    expect([200, 202]).toContain(
      (await deliver(JSON.stringify(payload(releaseId + 2, false)))).status
    )
    // Earlier fixture workspaces may share this installation; only this tenant stops.
    expect(
      await queryRows(database, 'SELECT id FROM release_source_event WHERE "organizationId"=$1', [
        organizationId,
      ])
    ).toHaveLength(2)
  } finally {
    await database.end()
    await unbindTestGoOrganization(organizationId)
    await provider.close()
  }
})

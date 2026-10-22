import { createHash, randomBytes } from 'node:crypto'
import { requestJson, uploadSignedAsset, browserRequest } from './framework/browser'
import { openNewDraft, expectSaved } from './framework/content-drafts'
import { mkdir } from 'node:fs/promises'
import { getActiveOrganizationId, signUpViaApi } from './framework/auth'
import { configureE2EFlow, expect, test } from './framework/flow'
import { grantWorkspacePlan, createE2EDatabase } from './framework/services'
import { trpcMutation, trpcQuery } from './framework/trpc'

configureE2EFlow({
  beforeEach: async ({ identity, page }) => {
    await signUpViaApi(identity, page)
    const result = await trpcMutation(page, 'workspace.create', {
      name: identity.workspaceName,
      slug: identity.email.split('@')[0],
    })
    expect(result.status).toBe(200)
    await grantWorkspacePlan(await getActiveOrganizationId(page), 'pro')
    await mkdir('.context/ux-redesign', { recursive: true })
  },
})
test.setTimeout(300_000)

test('job navigation preserves projects and one command owner restores focus', async ({ page }) => {
  const created = await trpcMutation(page, 'project.create', {
    name: 'Navigation proof',
    document: { version: 2, image: { src: null } },
  })
  expect(created.status).toBe(200)
  const id = (created.body as { id: string }).id
  await page.goto('/home')
  const sidebar = page.getByRole('complementary', { name: 'Primary navigation' })
  await expect(sidebar).toHaveAttribute('data-navigation', 'expanded')
  for (const name of [
    'Home',
    'Create',
    'Campaigns',
    'Publish',
    'Library',
    'Automate',
    'Activity',
    'Settings',
  ])
    await expect(sidebar.getByRole('link', { name, exact: true })).toBeVisible()
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('link', { name: /Navigation proof/ })).toHaveAttribute(
    'href',
    `/?project=${id}`
  )
  const search = sidebar.getByRole('button', { name: 'Search and commands' })
  await search.focus()
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.getByRole('searchbox', { name: 'Search destinations' }).fill('library')
  await expect(
    page.getByRole('navigation', { name: 'Search results' }).getByRole('link', { name: /Library/ })
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(search).toBeFocused()
  await sidebar.getByRole('link', { name: 'Library', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
  await expect(page.getByText('Screenshot projects · Saved to workspace')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Navigation proof' })).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: '.context/ux-redesign/library-desktop.png', fullPage: true })
  await page.goto(`/editor?project=${id}&editor=screenshot`)
  await expect(page).toHaveURL(new RegExp(`[?]project=${id}&editor=screenshot$`))
  expect((await trpcQuery(page, 'project.get', { projectId: id })).status).toBe(200)
  await page.goto(`/fr/home?project=${id}&editor=screenshot`)
  await expect(page).toHaveURL(new RegExp(`/fr[?]project=${id}&editor=screenshot$`))
})

test('mobile settings puts content first and local work remains explicitly local', async ({
  page,
}) => {
  for (const width of [320, 390, 767, 768, 769, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/workspace/appearance')
    await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    if (width < 1024) {
      const chooser = page.getByRole('button', { name: 'Settings / Appearance' })
      await expect(chooser).toBeVisible()
      await chooser.click()
      const dialog = page.getByRole('dialog', { name: 'Choose a settings section' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('searchbox').fill('security')
      await expect(dialog.getByRole('link', { name: 'Security', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(chooser).toBeFocused()
    }
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '.context/ux-redesign/settings-mobile.png', fullPage: true })
  await page.goto('/library?type=store')
  await expect(page.getByText('On this browser only.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toBeVisible()
  await page
    .getByRole('dialog', { name: 'Navigation', exact: true })
    .getByRole('link', { name: 'Create', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Create', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({ path: '.context/ux-redesign/create-mobile.png', fullPage: true })
})

test('workflow and release views are separate, and an explicit compact preference survives', async ({
  page,
}) => {
  await page.goto('/workflows?view=sources')
  await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Workflow summary' })).toHaveCount(0)
  await page
    .getByRole('navigation', { name: 'Automate', exact: true })
    .getByRole('link', { name: 'Workflows', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible()
  await page.goto('/campaigns/releases')
  await expect(page.getByRole('heading', { name: 'Release inbox', exact: true })).toBeVisible()
  await page.goto('/workspace/appearance')
  await page.getByRole('radio', { name: /^Always compact/ }).check()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toHaveAttribute(
    'data-navigation',
    'compact'
  )
  await page.getByRole('button', { name: 'Expand navigation' }).click()
  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toHaveAttribute(
    'data-navigation',
    'expanded'
  )
})

test('Library attaches an existing asset and refuses one deleted after selection', async ({
  page,
}) => {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFgAI/ScL6fQAAAABJRU5ErkJggg==',
    'base64'
  )
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const upload = async (fileName: string) => {
    const signed = await requestJson(page, '/api/tenant/assets/upload-url', {
      bytes: bytes.length,
      classification: 'input',
      contentType: 'image/png',
      fileName,
      sha256,
    })
    expect(signed.status).toBe(201)
    const { asset, uploadUrl } = signed.body as { asset: { id: string }; uploadUrl: string }
    expect(await uploadSignedAsset(page, uploadUrl, [...bytes], 'image/png')).toBe(200)
    expect(
      (await requestJson(page, `/api/tenant/assets/${asset.id}/complete`, { sha256 })).status
    ).toBe(200)
    return asset.id
  }
  const kept = await upload('kept-library.png')
  const removed = await upload('removed-library.png')
  const draftId = await openNewDraft(page)
  const attach = page.getByRole('button', { name: 'Attach from Library', exact: true })
  await attach.click()
  const picker = page.getByRole('dialog', { name: 'Attach from Library' })
  await picker.getByRole('button', { name: 'removed-library.png', exact: true }).click()
  expect((await trpcMutation(page, 'asset.delete', { assetId: removed })).status).toBe(200)
  await picker.getByRole('button', { name: 'Attach selected' }).click()
  await expect(picker.getByRole('alert')).toBeVisible()
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'kept-library.png', exact: true }).click()
  await picker.getByRole('button', { name: 'Attach selected' }).click()
  await expect(picker).toHaveCount(0)
  await expectSaved(page)
  const saved = await browserRequest(page, `/api/v1/content-drafts/${draftId}`)
  expect(saved.status).toBe(200)
  expect(JSON.stringify(saved.body)).toContain(kept)
  expect(JSON.stringify(saved.body)).not.toContain(removed)
  expect((await trpcQuery(page, 'asset.signDownload', { assetId: kept })).status).toBe(200)
  await page.reload()
  await expect(
    page.getByRole('textbox', { name: 'Draft body' }).locator(`img[src*="${kept}"]`)
  ).toBeVisible()
})

test('a failed preview retries without rewriting the saved project', async ({ page }) => {
  const document = { version: 2, image: { src: '/demo/notion-showcase.webp' } }
  const created = await trpcMutation(page, 'project.create', { name: 'Retry proof', document })
  const id = (created.body as { id: string }).id
  const before = await trpcQuery(page, 'project.get', { projectId: id })
  let requests = 0
  await page.route('**/demo/notion-showcase.webp', async (route) => {
    requests++
    await route.abort()
  })
  await page.goto('/library')
  await expect(
    page.getByText('Preview could not render. Open the original to keep working.')
  ).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('link', { name: 'Open Retry proof' })).toHaveAttribute(
    'href',
    `/?project=${id}`
  )
  const failedRequests = requests
  await page.getByRole('button', { name: 'Retry preview' }).click()
  await expect.poll(() => requests).toBeGreaterThan(failedRequests)
  await page.unroute('**/demo/notion-showcase.webp')
  await page.getByRole('button', { name: 'Retry preview' }).click()
  await expect(page.getByRole('img', { name: 'Preview of Retry proof' })).toBeVisible({
    timeout: 60_000,
  })
  expect((await trpcQuery(page, 'project.get', { projectId: id })).body).toEqual(before.body)
})

test('localized destinations and light-theme reflow retain keyboard access', async ({ page }) => {
  await page.goto('/workspace/appearance')
  await page.getByRole('radio', { name: /^Light/ }).check()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible()
  await page.goto('/fr/home')
  const sidebar = page.getByRole('complementary', { name: 'Primary navigation' })
  await expect(sidebar.getByRole('link', { name: 'Bibliothèque', exact: true })).toHaveAttribute(
    'href',
    '/fr/library'
  )
  await sidebar.getByRole('link', { name: 'Bibliothèque', exact: true }).click()
  await expect(page).toHaveURL(/\/fr\/library$/)
  await expect(page.locator('html')).toHaveClass(/\blight\b/)
  // 640 and 320 CSS px model the reflow available at 200% and 400% on a 1280px viewport.
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 900 })
    for (const direction of ['ltr', 'rtl']) {
      await page.evaluate((dir) => {
        document.documentElement.dir = dir
      }, direction)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      )
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({ path: '.context/ux-redesign/library-light-rtl.png', fullPage: true })
})

test('workflow graph stays in the shell and preserves validation, test, and dirty navigation', async ({
  page,
  identity,
}) => {
  const database = createE2EDatabase()
  const installationId = `c${randomBytes(12).toString('hex')}`
  const sourceId = `c${randomBytes(12).toString('hex')}`
  const organizationId = await getActiveOrganizationId(page)
  try {
    // Local protocol fixture: no GitHub account or worker is contacted.
    await database.query(
      `INSERT INTO github_installation (id, "installationId", "accountLogin", "accountType", "updatedAt") VALUES ($1, $2, 'fixture', 'Organization', now())`,
      [installationId, Date.now()]
    )
    await database.query(
      `INSERT INTO workspace_github_installation (id, "organizationId", "githubInstallationId", "connectedByUserId") SELECT $1, $2, $3, id FROM "user" WHERE email=$4`,
      [`c${randomBytes(12).toString('hex')}`, organizationId, installationId, identity.email]
    )
    await database.query(
      `INSERT INTO source_app (id, "organizationId", name, provider, "externalId", "allowedHosts", "githubInstallationId", status, "updatedAt") VALUES ($1, $2, 'fixture/product', 'github', '123', '[]', $3, 'ACTIVE', now())`,
      [sourceId, organizationId, installationId]
    )
    await page.goto('/workflows/new')
    await page.getByRole('button', { name: 'Start with a blank workflow' }).click()
    await page.getByRole('button', { name: 'Open blank draft' }).click()
    const editor = page.getByRole('main', { name: 'Workflow editor', exact: true })
    await expect(editor).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible()
    await page.getByLabel('Definition name').fill('Shell workflow proof')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page).toHaveURL(/\/workflows\/c[a-z0-9]+$/)
    await page.getByRole('tab', { name: 'Workflow', exact: true }).click()
    await page.getByLabel('Priority', { exact: true }).fill('99999')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByLabel('Priority', { exact: true })).toBeFocused()
    await expect(page.getByRole('region', { name: 'Workflow canvas' })).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByLabel('Priority', { exact: true }).fill('77')
    await page.getByRole('button', { name: 'Close editor', exact: true }).click()
    const discard = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })
    await expect(discard).toBeVisible()
    await discard.getByRole('button', { name: 'Keep editing' }).click()
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByText('Draft saved and validated by the backend.')).toBeVisible()
    await page.getByRole('button', { name: 'Test draft', exact: true }).click()
    await expect(page.getByText('Preview: completed', { exact: true })).toBeVisible()
    const overview = await trpcQuery(page, 'releaseAutomation.overview', undefined)
    const definitions = (
      overview.body as {
        definitions: {
          name: string
          priority: number
          enabled: boolean
          activeVersionId: string | null
        }[]
      }
    ).definitions
    expect(definitions.find((item) => item.name === 'Shell workflow proof')).toMatchObject({
      priority: 77,
      enabled: false,
      activeVersionId: null,
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: '.context/ux-redesign/workflow-desktop.png', fullPage: true })
  } finally {
    await database.query(
      'DELETE FROM workspace_github_installation WHERE "githubInstallationId"=$1',
      [installationId]
    )
    await database.query('DELETE FROM github_installation WHERE id=$1', [installationId])
    await database.end()
  }
})

test('all template families have previews and hidden scrollbars retain scrolling', async ({
  page,
}) => {
  const before = await trpcQuery(page, 'releaseAutomation.overview')
  await page.goto('/library?view=templates')
  const catalog = page.getByRole('region', { name: 'Template previews' })
  await expect(catalog).toBeVisible()
  const previews = catalog.getByRole('img', { name: /^Preview of / })
  await expect(previews.first()).toBeVisible()
  await expect(catalog.locator('img').first()).toBeVisible()
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth)).toBe(
    'none'
  )
  expect(
    await page.evaluate(() => getComputedStyle(document.body, '::-webkit-scrollbar').display)
  ).toBe('none')
  await page.mouse.move(1000, 650)
  await page.mouse.wheel(0, 800)
  await expect
    .poll(() => page.locator('[data-platform-scroll]').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  await page.locator('[data-platform-scroll]').evaluate((el) => el.scrollTo(0, 0))
  await page.locator('[data-platform-scroll]').focus()
  await page.keyboard.press('PageDown')
  await expect
    .poll(() => page.locator('[data-platform-scroll]').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  for (const category of [
    'Animated',
    'Layouts & presets',
    'Canvas',
    'Store screenshots',
    'Workflows',
  ]) {
    await catalog.getByRole('button', { name: category, exact: true }).click()
    await expect(previews.first()).toBeVisible()
    expect(await previews.count()).toBeGreaterThan(0)
    if (category === 'Layouts & presets') {
      for (const preview of await previews.all()) {
        await preview.scrollIntoViewIfNeeded()
        await expect(preview.locator('img')).toBeVisible({ timeout: 60000 })
      }
    }
    if (category === 'Canvas')
      await expect(catalog.locator('[data-recipe-preview] img').first()).toBeVisible({
        timeout: 60000,
      })
    if (category === 'Store screenshots') {
      await expect(catalog.locator('[data-store-slide-render]').first()).toBeVisible({
        timeout: 60000,
      })
      await page.screenshot({
        path: '.context/ux-redesign/store-template-previews.png',
        fullPage: false,
        style: 'nextjs-portal {display:none}',
      })
    }
    if (category === 'Workflows') {
      await expect(previews).toHaveCount(5)
      await expect(catalog.locator('svg').first()).toBeVisible()
      await page.screenshot({
        path: '.context/ux-redesign/template-catalog.png',
        fullPage: true,
        style: 'nextjs-portal {display:none}',
      })
    }
  }
  expect((await trpcQuery(page, 'releaseAutomation.overview')).body).toEqual(before.body)
  await page.goto('/workflows/new')
  const diagrams = page.getByRole('img', { name: /workflow preview$/ })
  await expect(diagrams).toHaveCount(5)
  expect((await diagrams.first().boundingBox())?.height).toBeGreaterThan(200)
  await page.getByRole('button', { name: /Product launch from a GitHub release/ }).click()
  await expect(page.getByRole('heading', { name: 'Configure', exact: true })).toBeVisible()
  expect((await trpcQuery(page, 'releaseAutomation.overview')).body).toEqual(before.body)
  await page.screenshot({
    path: '.context/ux-redesign/workflow-template-previews.png',
    fullPage: true,
    style: 'nextjs-portal {display:none}',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/create?view=templates')
  await expect(page.getByRole('region', { name: 'Template previews' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.goto('/workspace/appearance')
  await expect(page.getByRole('switch', { name: 'Show scrollbars' })).toHaveCount(0)
})

test('sidebar choices persist across client navigation and content scrolls inside the shell', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/workspace/appearance')
  await page.getByRole('radio', { name: /^Always compact/ }).check()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible()
  const sidebar = page.getByRole('complementary', { name: 'Primary navigation' })
  await page.getByRole('button', { name: 'Expand navigation' }).click()
  await expect(sidebar).toHaveAttribute('data-navigation', 'expanded')
  const documents: string[] = []
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documents.push(request.url())
  })
  for (const name of ['Home', 'Library', 'Automate', 'Create']) {
    await sidebar.getByRole('link', { name, exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible()
    await expect(sidebar).toHaveAttribute('data-navigation', 'expanded')
  }
  expect(documents).toEqual([])
  await expect(sidebar).toHaveCSS('border-right-width', '0px')
  await expect(
    sidebar.getByRole('link', { name: 'Home', exact: true }).locator('svg')
  ).toHaveAttribute('viewBox', '0 0 256 256')
  const toggle = sidebar.getByRole('button', { name: 'Collapse navigation' })
  const workspace = sidebar.getByRole('button', { name: /^Workspace:/ })
  expect(
    Math.abs((await toggle.boundingBox())!.y - (await workspace.boundingBox())!.y)
  ).toBeLessThan(12)
  await toggle.click()
  await expect(sidebar).toHaveAttribute('data-navigation', 'compact')
  await sidebar.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  await expect(sidebar).toHaveAttribute('data-navigation', 'compact')
  await page.screenshot({
    path: '.context/ux-redesign/home-compact-polished.png',
    style: 'nextjs-portal {display:none}',
  })
  await page.reload()
  await expect(sidebar).toHaveAttribute('data-navigation', 'compact')
  await sidebar.getByRole('button', { name: 'Expand navigation' }).click()
  await page.screenshot({
    path: '.context/ux-redesign/home-polished.png',
    style: 'nextjs-portal {display:none}',
  })
  await sidebar.getByRole('button', { name: 'Search and commands' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect
    .poll(async () => (await page.getByRole('dialog').boundingBox())!.width)
    .toBeCloseTo(1440 * 0.8, 0)
  await page.screenshot({
    path: '.context/ux-redesign/search-polished.png',
    style: 'nextjs-portal {display:none}',
  })
  await page.keyboard.press('Escape')
  await sidebar.getByRole('link', { name: 'Publish', exact: true }).click()
  await expect(page.getByTestId('write-frame')).toBeVisible()
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect
    .poll(async () => (await page.getByRole('dialog').boundingBox())!.width)
    .toBeCloseTo(1440 * 0.8, 0)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  await page.screenshot({
    path: '.context/ux-redesign/home-mobile-polished.png',
    style: 'nextjs-portal {display:none}',
  })
  await page.mouse.move(200, 600)
  await page.mouse.wheel(0, 900)
  await expect
    .poll(() => page.locator('[data-platform-scroll]').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toBeVisible()
  await page
    .getByRole('dialog', { name: 'Navigation', exact: true })
    .getByRole('link', { name: 'Automate', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Automate', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('theme switch persists across pages and reloads, with an honest rollback on failure', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/home')
  const light = page.getByRole('button', { name: 'Switch to light mode' }).filter({ visible: true })
  await expect(light).toBeEnabled()
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/me/preferences') && response.request().method() === 'PATCH'
  )
  await light.click()
  expect((await saved).status()).toBe(200)
  await expect(page.locator('html')).toHaveClass(/light/)
  await page.screenshot({ path: '.context/ux-redesign/home-light.png', fullPage: true })
  await page
    .getByRole('complementary', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Library', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/light/)
  await page.reload()
  const dark = page.getByRole('button', { name: 'Switch to dark mode' }).filter({ visible: true })
  await expect(dark).toBeEnabled()
  await page.route('**/api/v1/me/preferences', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Temporarily unavailable' }),
        })
      : route.continue()
  )
  await dark.click()
  await expect(page.getByText('Temporarily unavailable', { exact: false }).first()).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/light/)
  await page.unroute('**/api/v1/me/preferences')
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileDark = page
    .getByRole('button', { name: 'Switch to dark mode' })
    .filter({ visible: true })
  await expect(mobileDark).toBeEnabled()
  await mobileDark.focus()
  const darkSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/me/preferences') && response.request().method() === 'PATCH'
  )
  await page.keyboard.press('Enter')
  expect((await darkSaved).status()).toBe(200)
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.goto('/home')
  await expect(page.getByText('No notifications', { exact: true })).toBeVisible()
  await page.screenshot({ path: '.context/ux-redesign/home-dark-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: '.context/ux-redesign/home-dark.png', fullPage: true })
})

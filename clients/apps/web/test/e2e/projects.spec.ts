import {
  createWorkspace,
  expect,
  type Page,
  type Route,
  test,
  trpcMutation,
  trpcQuery,
} from './framework'

test.use({ workspaceOptions: { plan: 'pro' } })

const texts = (page: Page) => page.locator('[data-html-canvas="true"] [data-text-overlay-id]')
const projectButton = (page: Page, name: string, status = 'Saved') =>
  page.getByRole('button', { name: `Project ${name}: ${status}` })

async function addText(page: Page) {
  await page.getByRole('button', { exact: true, name: 'Add Text' }).first().click()
}

async function saveAsProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'Save as project' }).click()
  await page.getByLabel('Project name').fill(name)
  await page.getByRole('button', { name: 'Save project' }).click()
  await expect(projectButton(page, name)).toBeVisible({ timeout: 30_000 })
  return new URL(page.url()).searchParams.get('project') ?? ''
}

async function projectMenu(page: Page, name: string, item: string) {
  await page.getByRole('button', { name: new RegExp(`^Project ${name}:`) }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

test('a project autosaves, reopens after a reload, and restores a named version', async ({
  app,
  page,
}) => {
  await app.openEditor()
  await addText(page)
  await expect(texts(page)).toHaveCount(1)
  const projectId = await saveAsProject(page, 'Launch hero')
  expect(projectId).not.toBe('')

  await projectMenu(page, 'Launch hero', 'Save version…')
  await page.getByLabel('Version name').fill('One headline')
  await page.getByRole('button', { name: 'Save version' }).click()
  await expect(page.getByText('Saved version “One headline”')).toBeVisible()

  // An edit saves by itself.
  await addText(page)
  await expect(texts(page)).toHaveCount(2)
  const revision = async () =>
    ((await trpcQuery(page, 'project.get', { projectId })).body as { revision: number }).revision
  await expect.poll(revision, { timeout: 30_000 }).toBeGreaterThan(1)
  await expect(projectButton(page, 'Launch hero')).toBeVisible({ timeout: 30_000 })

  // A reload reopens the project from the address bar.
  await app.reload()
  await expect(projectButton(page, 'Launch hero')).toBeVisible({ timeout: 60_000 })
  await expect(texts(page)).toHaveCount(2)

  const beforeRestore = await revision()
  await projectMenu(page, 'Launch hero', 'Version history')
  const history = page.getByRole('dialog', { name: 'Version history' })
  await history.getByRole('button', { name: /One headline/ }).click()
  await expect(history.getByText('Differs in')).toBeVisible({ timeout: 30_000 })
  await history.getByRole('button', { name: 'Restore this version' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByText('Restored “One headline”')).toBeVisible({ timeout: 30_000 })
  await expect(texts(page)).toHaveCount(1)
  expect(await revision()).toBeGreaterThan(beforeRestore)
})

test('unsaved changes survive a reload before autosave runs', async ({ app, page }) => {
  await app.openEditor()
  await saveAsProject(page, 'Interrupted')
  // Saves cannot reach the server (the leave-page save included), so the edit
  // exists only in this device's draft when the page reloads.
  const blockSaves = (route: Route) => route.abort('internetdisconnected')
  await page.route('**/api/trpc/**project.updateDocument**', blockSaves)
  await addText(page)
  await expect(projectButton(page, 'Interrupted', 'Offline, saved on this device')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('Your project has not been saved', { exact: true })).toBeVisible()
  // Let the draft autosave (1 s) write the edit before reloading.
  // eslint-disable-next-line no-restricted-syntax -- The local draft autosave runs on a 1 s timer and fires no event.
  await page.waitForTimeout(2_000)
  await app.reload()
  await page.unroute('**/api/trpc/**project.updateDocument**', blockSaves)
  await expect(page.getByText('Recovered your unsaved changes')).toBeVisible({ timeout: 60_000 })
  await expect(texts(page)).toHaveCount(1)
  await expect(projectButton(page, 'Interrupted')).toBeVisible({ timeout: 30_000 })
})

test('a stale write is refused and can be kept as a copy', async ({ app, page }) => {
  await app.openEditor()
  const projectId = await saveAsProject(page, 'Shared')

  // Someone else saves the project first.
  const current = await trpcQuery(page, 'project.get', { projectId })
  const { document, revision } = current.body as { document: unknown; revision: number }
  const other = await trpcMutation(page, 'project.updateDocument', {
    baseRevision: revision,
    document,
    projectId,
  })
  expect(other.status).toBe(200)

  await addText(page)
  const dialog = page.getByRole('alertdialog', { name: 'This project changed elsewhere' })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole('button', { name: 'Keep mine as a copy' }).click()
  await expect(page.getByText('Saved your changes as “Shared (my changes)”')).toBeVisible({
    timeout: 30_000,
  })
  const after = await trpcQuery(page, 'project.get', { projectId })
  expect((after.body as { revision: number }).revision).toBe(revision + 1)
})

test('the library searches, duplicates, and deletes, and other workspaces see nothing', async ({
  app,
  browser,
  identity,
  page,
}) => {
  const document = { image: { src: null }, version: 2 }
  const created = await trpcMutation(page, 'project.create', { document, name: 'Pricing banner' })
  await trpcMutation(page, 'project.create', { document, name: 'Changelog card' })
  const projectId = (created.body as { id: string }).id

  await app.open('/projects')
  await page.getByRole('searchbox', { name: 'Search projects' }).fill('pricing')
  await expect(page.getByRole('link', { exact: true, name: 'Pricing banner' })).toBeVisible()
  await expect(page.getByRole('link', { exact: true, name: 'Changelog card' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Actions for Pricing banner' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(page.getByRole('link', { exact: true, name: 'Pricing banner copy' })).toBeVisible()

  await page.getByRole('button', { name: 'Actions for Pricing banner copy' }).click()
  await page.getByRole('menuitem', { name: 'Delete…' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Delete “Pricing banner copy”?' })
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('link', { exact: true, name: 'Pricing banner copy' })).toBeVisible()
  await page.getByRole('button', { name: 'Actions for Pricing banner copy' }).click()
  await page.getByRole('menuitem', { name: 'Delete…' }).click()
  await confirm.getByRole('button', { name: 'Delete project' }).click()
  await expect(page.getByRole('link', { exact: true, name: 'Pricing banner copy' })).toHaveCount(0)

  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()
  try {
    await createWorkspace(
      {
        ...identity,
        email: `other-${identity.email}`,
        workspaceName: `Other ${identity.workspaceName}`,
      },
      otherPage
    )
    expect((await trpcQuery(otherPage, 'project.get', { projectId })).status).toBe(404)
    expect((await trpcMutation(otherPage, 'canvas.openProject', { projectId })).status).toBe(404)
    const canvases = await trpcQuery(otherPage, 'canvas.list', {})
    expect((canvases.body as { items: unknown[] }).items).toHaveLength(0)
    const list = await trpcQuery(otherPage, 'project.list', {})
    expect((list.body as { items: unknown[] }).items).toHaveLength(0)
    const write = await trpcMutation(otherPage, 'project.updateDocument', {
      baseRevision: 1,
      document,
      projectId,
    })
    expect(write.status).toBe(404)
  } finally {
    await otherContext.close()
  }
})

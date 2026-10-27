import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { canvasDocumentSchema, type CanvasDocument } from '@/lib/canvas/document'
import { blankArtboard, buildRecipe } from '@/lib/canvas/recipes'
import { newCreativeSetId } from '@/lib/creative-sets/document'
import { getActiveOrganizationId, getE2EUrl, signUpViaApi } from './framework/auth'
import { chooseOption } from './framework/controls'
import { configureE2EFlow, expect, test } from './framework/flow'
import { grantWorkspacePlan } from './framework/services'
import { trpcMutation, trpcQuery } from './framework/trpc'

configureE2EFlow({
  beforeEach: async ({ identity, page }) => {
    await signUpViaApi(identity, page)
    const workspace = await trpcMutation(page, 'workspace.create', {
      name: identity.workspaceName,
      slug: identity.email.split('@')[0],
    })
    expect(workspace.status).toBe(200)
    await grantWorkspacePlan(await getActiveOrganizationId(page), 'pro')
    await mkdir(path.resolve('.context/canvas-regressions'), { recursive: true })
  },
})
test.setTimeout(300_000)
test.use({ viewport: { width: 1156, height: 900 }, actionTimeout: 30_000 })

async function create(
  page: Page,
  name: string,
  artboards = [blankArtboard('wide-16x9', { x: 0, y: 0 })]
) {
  const id = newCreativeSetId()
  const result = await trpcMutation(page, 'canvas.create', {
    id,
    name,
    document: canvasDocumentSchema.parse({ version: 1, kind: 'canvas', artboards }),
  })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  await page.goto(getE2EUrl(`/canvas/${id}`))
  await expect(page.getByTestId('canvas-workspace')).toBeVisible({ timeout: 120_000 })
  return id
}

async function stored(page: Page, canvasId: string) {
  const result = await trpcQuery(page, 'canvas.get', { canvasId })
  expect(result.status).toBe(200)
  return result.body as { revision: number; document: CanvasDocument }
}

async function openText(page: Page, words: string) {
  if (!(await page.getByTestId('canvas-active-editor').count())) {
    await page.getByRole('tab', { name: 'Artboards', exact: true }).click()
    await page
      .getByRole('list', { name: 'Artboards', exact: true })
      .getByRole('button', { name: /^16:9 / })
      .click()
    await page.keyboard.press('Enter')
    await expect
      .poll(
        () =>
          page
            .getByTestId('canvas-active-editor')
            .evaluate((node) => getComputedStyle(node).opacity),
        { timeout: 120_000 }
      )
      .toBe('1')
  }
  await page
    .locator('#image-render-card [data-text-overlay-id]')
    .filter({ hasText: words })
    .first()
    .dblclick()
  const field = page.getByTestId('inline-text-editor')
  await expect(field).toBeFocused()
  return field
}

test('Escape keeps text undoable and leaving waits for the cloud save', async ({ page }) => {
  const name = 'A very long canvas title '.repeat(8).slice(0, 200)
  const id = await create(page, name, [
    blankArtboard('wide-16x9', { x: 0, y: 0 }),
    blankArtboard('square-1x1', { x: 1700, y: 0 }),
  ])
  await expect(page).toHaveTitle(`${name} · Canvas`)
  const header = page.locator('[data-testid="canvas-workspace"] > header')
  expect((await header.boundingBox())!.height).toBeLessThan(80)
  const zoom = page.getByRole('button', { name: /^Zoom \d/ })
  const before = await zoom.textContent()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(zoom).not.toHaveText(before!)
  await page.getByRole('button', { name: 'Grid', exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Show grid' })).toBeVisible()
  await page.keyboard.press('Escape')

  const field = await openText(page, 'Add a headline')
  await field.fill('Escape test')
  await expect(page.getByText('Editing Text', { exact: true })).toBeVisible()
  await field.press('Escape')
  await expect(field).toHaveCount(0)
  await expect
    .poll(async () => (await stored(page, id)).document.artboards[0]!.document.texts[0]!.text)
    .toBe('Escape test')
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click()
  await expect
    .poll(async () => (await stored(page, id)).document.artboards[0]!.document.texts[0]!.text)
    .toBe('Add a headline')
  await page.getByRole('button', { name: 'Redo', exact: true }).first().click()
  const pending = await openText(page, 'Escape test')
  await pending.fill('Saved before leaving')
  const writes = '**/api/trpc/*canvas.updateDocument*'
  await page.route(writes, (route) => route.abort('connectionfailed'))
  await page.getByRole('link', { name: 'Back to Canvas', exact: true }).click()
  await expect(page.getByText('The canvas could not be saved.', { exact: false })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/canvas/${id}$`))
  await page.unroute(writes)
  const write = page.waitForResponse(
    (response) => response.url().includes('canvas.updateDocument') && response.status() === 200
  )
  await page.getByRole('link', { name: 'Back to Canvas', exact: true }).click()
  await write
  await expect(page).toHaveURL(/\/canvas$/)
  expect((await stored(page, id)).document.artboards[0]!.document.texts[0]!.text).toBe(
    'Saved before leaving'
  )
  await page.goto(getE2EUrl(`/canvas/${id}`))
  await expect(page.getByRole('dialog', { name: 'Recover unsaved work' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Artboards', exact: true }).click()
  await page
    .getByRole('list', { name: 'Artboards', exact: true })
    .getByRole('button', { name: /^16:9 / })
    .click()
  await page.getByLabel('Artboard name').fill('')
  await page.getByLabel('Artboard name').press('Enter')
  await expect(page.getByLabel('Artboard name')).toHaveValue('16:9')
})

test('long export names fit, previews render, and text collisions refuse delivery', async ({
  page,
}) => {
  const longName = 'Feature announcement with a very long name '.repeat(4).slice(0, 120)
  const board = blankArtboard('wide-16x9', { x: 0, y: 0, name: longName })
  const id = await create(page, 'Export regression', [board])
  await page.getByRole('button', { name: 'Export', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Export artboards' })
  for (const width of [1156, 740, 390]) {
    await page.setViewportSize({ width, height: 800 })
    await chooseOption(
      dialog.getByLabel('Export format'),
      'PDF · selectable text and vector shapes'
    )
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    for (const label of ['Cancel', 'Render 1']) {
      const box = (await dialog.getByRole('button', { name: label, exact: true }).boundingBox())!
      const bounds = (await dialog.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(bounds.x)
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width)
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height)
    }
  }
  await page.setViewportSize({ width: 1156, height: 900 })
  await chooseOption(dialog.getByLabel('Export format'), 'PNG')
  await dialog.getByRole('button', { name: 'Render 1', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Download', exact: true })).toBeEnabled({
    timeout: 120_000,
  })
  await expect(
    dialog.getByRole('img', { name: `Preview of ${longName}`, exact: true })
  ).toBeVisible()
  await page.screenshot({ path: path.resolve('.context/canvas-regressions/export.png') })
  await dialog.getByRole('button', { name: 'Change settings', exact: true }).click()
  await dialog.getByRole('button', { name: 'Render 1', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Download', exact: true })).toBeEnabled()
  const checkpoints = await trpcQuery(page, 'canvas.versions', { canvasId: id })
  expect(
    (checkpoints.body as { kind: string }[]).filter((version) => version.kind === 'named')
  ).toHaveLength(1)
  await dialog.getByRole('button', { name: 'Save to workspace', exact: true }).click()
  await expect(
    dialog.getByRole('button', { name: 'Saved to workspace', exact: true })
  ).toBeVisible()
  const delivered = await stored(page, id)
  expect(delivered.revision).toBe(2)
  expect(delivered.document.deliveries[0]!.revision).toBe(1)
  await expect(dialog.getByText('Files from revision 1. Current canvas revision: 2.')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'History', exact: true }).click()
  const history = page.getByRole('dialog', { name: 'Version history' })
  const checkpoint = history.getByRole('listitem').filter({ hasText: 'Delivery revision 1' })
  await expect(checkpoint).toContainText('Revision 1')
  await checkpoint.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(history.getByRole('group', { name: 'Confirm restore' })).toBeVisible()
  expect((await stored(page, id)).revision).toBe(2)
  await history.getByRole('button', { name: 'Cancel restore', exact: true }).click()
  await checkpoint.getByRole('button', { name: 'Restore', exact: true }).click()
  await history.getByRole('button', { name: 'Confirm restore', exact: true }).click()
  await expect.poll(async () => (await stored(page, id)).revision).toBe(3)
  expect((await stored(page, id)).document.deliveries).toHaveLength(0)
  await page.keyboard.press('Escape')

  const headline =
    'An announcement with enough words to collide with the badge and supporting text. '
      .repeat(3)
      .slice(0, 180)
  const collisionBoards = buildRecipe('feature-announcement', { headline })
  await create(page, 'Collision regression', collisionBoards)
  await page.getByRole('button', { name: 'Export', exact: true }).first().click()
  await dialog.getByRole('button', { name: 'Render 1', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('overlaps', { timeout: 120_000 })
  await expect(dialog.getByRole('button', { name: 'Download', exact: true })).toBeDisabled()
})

test('library copies are identifiable and archived canvases can be restored', async ({ page }) => {
  const name = 'Library regression'
  const id = await create(page, name)
  await page.getByRole('link', { name: 'Back to Canvas', exact: true }).click()
  await page.getByLabel('Search canvases').fill(name)
  await chooseOption(page.getByLabel('Sort canvases'), 'Name')
  await expect(page).toHaveURL(/search=Library\+regression&sort=name/)
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
  await expect(page.getByRole('heading', { name: `${name} (copy)`, exact: true })).toBeVisible()
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Archive…', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0)
  await chooseOption(page.getByLabel('Canvas view'), 'Archived canvases')
  await page.reload()
  await expect(page.getByLabel('Search canvases')).toHaveValue(name)
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Restore to active canvases', exact: true }).click()
  await chooseOption(page.getByLabel('Canvas view'), 'Active canvases')
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  expect((await stored(page, id)).document.artboards).toHaveLength(1)
})

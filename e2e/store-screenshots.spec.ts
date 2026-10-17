import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import type { Page } from '@playwright/test'
import { signUpAndCreateWorkspace } from './framework/auth'
import { configureE2EFlow, expect, test, type E2EIdentity } from './framework/flow'
import { grantWorkspacePlan } from './framework/services'

configureE2EFlow()

async function openStudio(identity: E2EIdentity, page: Page) {
  const organizationId = await signUpAndCreateWorkspace(identity, page)
  await grantWorkspacePlan(organizationId, 'pro')
  await page.goto('/store-screenshots')
  await page.getByRole('button', { name: 'Use the sample set' }).click()
  const canvas = page.locator('[data-store-canvas-slide]')
  await expect(canvas).toBeVisible()
  return canvas
}

async function editHeading(page: Page, text: string) {
  const box = (await page.locator('[data-store-canvas-slide]').boundingBox())!
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.1)
  await expect(page.locator('[data-store-inline-editor]')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
}

function pngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  return { width: view.getUint32(16), height: view.getUint32(20), colorType: bytes[25] }
}

test('edit on the canvas, undo, persist across reloads, and export exact store sizes', async ({
  identity,
  page,
}) => {
  const canvas = await openStudio(identity, page)
  await editHeading(page, 'Train smarter')
  await expect(canvas).toContainText('Train smarter')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(canvas).not.toContainText('Train smarter')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(canvas).toContainText('Train smarter')

  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-store-canvas-slide]')).toContainText('Train smarter')

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const exportButton = page.getByRole('button', { name: /^Export \d+ files$/ })
  const count = Number((await exportButton.textContent())!.match(/\d+/)![0])
  const download = page.waitForEvent('download')
  await exportButton.click()
  const zip = await JSZip.loadAsync(await readFile((await (await download).path())!))
  const files = Object.values(zip.files).filter((file) => !file.dir)
  expect(files).toHaveLength(count)
  for (const file of files) {
    const size = pngSize(await file.async('uint8array'))
    const [, width, height] = file.name.match(/_(\d+)x(\d+)\.png$/)!
    expect(size).toEqual({ width: Number(width), height: Number(height), colorType: 2 })
  }
  expect(
    files.some(
      (file) =>
        file.name.startsWith('app-store/en-US/iphone-6.9in/') &&
        file.name.endsWith('_1320x2868.png')
    )
  ).toBe(true)
})

test('share a read-only review link, comment through it, resolve, and revoke', async ({
  browser,
  identity,
  page,
}) => {
  await openStudio(identity, page)
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Share for review…' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Create link' }).click()
  const linkField = dialog.getByRole('textbox', { name: /^Review link for / }).first()
  await expect(linkField).toBeVisible({ timeout: 60_000 })
  const link = await linkField.inputValue()

  const reviewer = await browser.newContext()
  const reviewPage = await reviewer.newPage()
  await reviewPage.goto(link)
  await expect(reviewPage.getByText('You can comment; you cannot edit')).toBeVisible()
  await expect(reviewPage.locator('[data-store-canvas-slide]')).toHaveCount(0)
  await reviewPage
    .getByRole('button', { name: 'Click to place a comment pin on this slide' })
    .click({ position: { x: 40, y: 60 } })
  await reviewPage.getByLabel('Your name').fill('Riley Reviewer')
  await reviewPage
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Headline is too long on small phones')
  await reviewPage.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(reviewPage.getByText('Headline is too long on small phones')).toBeVisible()

  await dialog.getByRole('button', { name: 'Close' }).click()
  // Reorder: the commented slide moves to position 2, and its comment must follow it.
  const filmstrip = page.getByRole('listbox', { name: 'Slides' })
  const first = filmstrip.getByRole('option', { name: /^Slide 1 of / })
  const slideName = (await first.getAttribute('aria-label'))!.replace(/^Slide 1 of \d+: /, '')
  await first.focus()
  await page.keyboard.press('Alt+ArrowRight')
  await expect(
    filmstrip.getByRole('option', { name: new RegExp(`^Slide 2 of \\d+: ${slideName}`) })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Share for review…' }).click()
  await expect(dialog.getByText('Headline is too long on small phones')).toBeVisible()
  await expect(dialog.getByRole('button', { name: `Slide 2 · ${slideName}` })).toBeVisible()
  await dialog.getByRole('checkbox', { name: 'Resolved' }).check()
  await dialog.getByRole('button', { name: 'Revoke…' }).click()
  await dialog.getByRole('button', { name: 'Turn off link' }).click()
  await expect(dialog.getByText(/link turned off/)).toBeVisible()

  await reviewPage.goto(link)
  await expect(reviewPage.getByText('You can comment; you cannot edit')).toHaveCount(0)
  await reviewer.close()
})

test('a forged review link shows nothing', async ({ page }) => {
  await page.goto('/review/eyJmYWtlIjp0cnVlfQ~forged-signature-value')
  await expect(page.getByText('You can comment; you cannot edit')).toHaveCount(0)
})

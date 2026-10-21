import type { Page } from '@playwright/test'
import sharp from 'sharp'
import { signUpAndCreateWorkspace } from './framework/auth'
import { configureE2EFlow, expect, test } from './framework/flow'

configureE2EFlow()

/** Drop one solid-colour "screenshot" on the empty canvas. */
async function dropScreenshot(page: Page, color: string) {
  await page.evaluate(async (fill) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 800
    const context = canvas.getContext('2d')!
    context.fillStyle = fill
    context.fillRect(0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((png) => resolve(png!), 'image/png')
    )
    const data = new DataTransfer()
    data.items.add(new File([blob], `${fill.slice(1)}.png`, { type: 'image/png' }))
    document
      .querySelector('[data-local-dropzone]')!
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
  }, color)
  await expect(page.locator('img[alt="Main image"]')).toHaveCount(1)
}

/** A small PNG logo, as a file the logo picker accepts. */
async function logoFile() {
  return {
    buffer: await sharp({ create: { background: '#ffffff', channels: 4, height: 64, width: 160 } })
      .png()
      .toBuffer(),
    mimeType: 'image/png',
    name: 'acme-light.png',
  }
}

/** Export the design as PNG and return its decoded pixels. */
async function exportPng(page: Page) {
  await page.getByRole('button', { exact: true, name: 'Export' }).click()
  await page.getByRole('button', { exact: true, name: 'PNG' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export as PNG' }).click()
  const file = await (await download).path()
  await page.keyboard.press('Escape')
  return sharp(file!).raw().toBuffer({ resolveWithObject: true })
}

function pixel({ data, info }: Awaited<ReturnType<typeof exportPng>>, x: number, y: number) {
  const offset = (Math.round(y) * info.width + Math.round(x)) * info.channels
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!]
}

function expectNear(actual: number[], expected: number[], tolerance = 24) {
  expect(
    actual.every((value, index) => Math.abs(value - expected[index]!) <= tolerance),
    `pixel ${actual.join(',')} is not near ${expected.join(',')}`
  ).toBe(true)
}

test('a brand kit and a saved preset style another screenshot the same way', async ({
  identity,
  page,
}) => {
  test.setTimeout(240_000)
  await signUpAndCreateWorkspace(identity, page)
  await dropScreenshot(page, '#e5e7eb')
  await page.getByRole('button', { exact: true, name: 'Add Text' }).first().click()
  await expect(page.locator('[data-text-overlay-id]')).toHaveCount(1)

  // Create a kit with a solid brand background (the design's own) and a logo.
  await page.getByRole('button', { exact: true, name: 'New brand kit' }).click()
  const kitDialog = page.getByRole('dialog', { name: 'New brand kit' })
  await kitDialog.getByLabel('Name').fill('Acme')
  await kitDialog.getByLabel('Logo files').setInputFiles(await logoFile())
  await expect(kitDialog.getByLabel('Logo name')).toHaveValue('acme-light')
  await kitDialog.getByRole('button', { name: 'Create brand kit' }).click()
  await expect(kitDialog).toBeHidden()
  await expect(
    page.getByRole('list', { name: 'Brand kits' }).getByText('Acme', { exact: true })
  ).toBeVisible()

  await page.getByRole('button', { name: 'Apply Acme' }).click()
  await expect(page.getByText('Applied Acme')).toBeVisible()
  await expect(page.locator('[data-overlay-id="brand-logo"]')).toHaveCount(1)
  await expect(
    page.getByRole('list', { name: 'Brand kits' }).getByText(/applied \(v1\)/)
  ).toBeVisible()
  // Brand gradient: the kit background (#0b1020) in the top-left corner.
  const branded = await exportPng(page)
  // The canvas corners are rounded, so sample just inside them.
  expectNear(pixel(branded, 24, 24), [11, 16, 32])

  // Undo takes the whole brand application back in one step.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('[data-overlay-id="brand-logo"]')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(page.locator('[data-overlay-id="brand-logo"]')).toHaveCount(1)

  // Save the branded design as a preset.
  await page.getByRole('button', { name: 'Save design as preset' }).click()
  const save = page.getByRole('dialog', { name: 'Save as preset' })
  await save.getByLabel('Preset name').fill('Launch hero')
  await save.getByRole('button', { name: 'Save preset' }).click()
  await expect(save).toBeHidden()
  const presets = page.getByRole('list', { name: 'Saved presets' })
  await expect(presets.getByRole('button', { name: 'Apply preset Launch hero' })).toBeVisible()

  // A different screenshot on a plain canvas…
  await page.getByRole('button', { exact: true, name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Start over' }).click()
  await page
    .getByRole('alertdialog', { name: 'Start over?' })
    .getByRole('button', { name: 'Start over' })
    .click()
  await page.getByRole('button', { exact: true, name: 'Remove' }).click()
  await expect(page.locator('img[alt="Main image"]')).toHaveCount(0)
  await dropScreenshot(page, '#16a34a')
  await expect(page.locator('[data-overlay-id="brand-logo"]')).toHaveCount(0)

  // …takes the preset's look and keeps its own pixels.
  await presets.getByRole('button', { name: 'Apply preset Launch hero' }).click()
  await expect(page.getByText('Applied “Launch hero”')).toBeVisible()
  await expect(page.locator('[data-overlay-id="brand-logo"]')).toHaveCount(1)
  await expect(page.locator('[data-text-overlay-id]')).toHaveCount(1)
  const applied = await exportPng(page)
  expectNear(pixel(applied, 24, 24), [11, 16, 32])
  expectNear(pixel(applied, applied.info.width * 0.3, applied.info.height * 0.3), [22, 163, 74])

  // Rename, duplicate, and delete; the library is the workspace's, so it survives a reload.
  await presets.getByRole('button', { name: 'Launch hero options' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const rename = page.getByRole('dialog', { name: 'Rename preset' })
  await rename.getByLabel('Preset name').fill('Hero')
  await rename.getByRole('button', { name: 'Rename' }).click()
  await expect(presets.getByRole('button', { name: 'Apply preset Hero' })).toBeVisible()
  await presets.getByRole('button', { name: 'Hero options' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(presets.getByRole('button', { name: 'Apply preset Hero copy' })).toBeVisible()
  await presets.getByRole('button', { name: 'Hero copy options' }).click()
  await page.getByRole('menuitem', { name: 'Delete…' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete preset' }).click()
  await expect(presets.getByRole('button', { name: 'Apply preset Hero copy' })).toHaveCount(0)

  await page.reload()
  await expect(
    page
      .getByRole('list', { name: 'Saved presets' })
      .getByRole('button', { name: 'Apply preset Hero' })
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('list', { name: 'Saved presets' }).getByRole('listitem')).toHaveCount(
    1
  )
})

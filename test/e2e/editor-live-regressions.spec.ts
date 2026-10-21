import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import type { Page } from '@playwright/test'
import { signUpAndCreateWorkspace } from './framework/auth'
import { configureE2EFlow, expect, test } from './framework/flow'

configureE2EFlow()

const canvas = (page: Page) => page.locator('[data-html-canvas="true"]:visible')
const text = (page: Page) => canvas(page).locator('[data-text-overlay-id]')

async function png(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export as PNG', exact: true }).click()
  return readFile((await (await download).path())!)
}

async function relativeTextSize(page: Page) {
  const stage = (await canvas(page).boundingBox())!
  const label = (await text(page).boundingBox())!
  return { width: label.width / stage.width, height: label.height / stage.height }
}

test('mobile preserves the composition and exported pixels, with separate toolbar targets', async ({
  identity,
  page,
}) => {
  test.setTimeout(180_000)
  await signUpAndCreateWorkspace(identity, page)
  await page.setViewportSize({ width: 1728, height: 1028 })
  await page.getByRole('button', { name: 'Add Text', exact: true }).first().click()
  await page
    .getByLabel('Text content', { exact: true })
    .fill('QA • 20 October\nShip better screenshots 🚀')
  await page.getByRole('button', { name: '4:3', exact: true }).click()
  await page.getByLabel('Canvas width', { exact: true }).fill('1200')
  await page.getByLabel('Canvas height', { exact: true }).fill('900')
  await page.getByRole('button', { name: 'Set', exact: true }).click()
  await expect(page.getByRole('button', { name: '1200 × 900', exact: true })).toBeVisible()
  const desktop = await relativeTextSize(page)
  const desktopPng = await png(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => (await canvas(page).boundingBox())!.width).toBeLessThan(390)
  const mobile = await relativeTextSize(page)
  expect(mobile.width).toBeCloseTo(desktop.width, 3)
  expect(mobile.height).toBeCloseTo(desktop.height, 3)
  const targets = await page
    .getByRole('banner')
    .locator('button:visible, a:visible')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, y, width, height } = node.getBoundingClientRect()
        return { x, y, width, height, name: node.getAttribute('aria-label') || node.textContent }
      })
    )
  for (let i = 0; i < targets.length; i++) {
    const a = targets[i]!
    expect(a.x, String(a.name)).toBeGreaterThanOrEqual(0)
    expect(a.x + a.width, String(a.name)).toBeLessThanOrEqual(391)
    for (const b of targets.slice(i + 1)) {
      const overlap =
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1
      expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false)
    }
  }
  const mobilePng = await png(page)
  const before = await sharp(desktopPng).raw().toBuffer({ resolveWithObject: true })
  const after = await sharp(mobilePng).raw().toBuffer({ resolveWithObject: true })
  expect(after.info).toEqual(before.info)
  expect(after.info.width / after.info.height).toBeCloseTo(4 / 3)
  expect(after.data.equals(before.data)).toBe(true)
  await page.screenshot({ path: '.context/editor-fixes-mobile.png' })
  await page.setViewportSize({ width: 1728, height: 1028 })
  expect((await relativeTextSize(page)).width).toBeCloseTo(desktop.width, 3)
})

test('image compositions save and reopen; swatches and layer selections agree', async ({
  identity,
  page,
}) => {
  test.setTimeout(180_000)
  await signUpAndCreateWorkspace(identity, page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByText('Drag & drop, click to browse, or paste', { exact: true }).click()
  await (await chooser).setFiles(resolve('public/store-screenshot-write.png'))
  await page.getByRole('button', { name: 'Add Text', exact: true }).first().click()
  await page.getByLabel('Text content', { exact: true }).fill('Cloud composition QA')
  await page.getByRole('button', { name: 'Frame', exact: true }).click()
  await page
    .getByLabel('Add screenshots', { exact: true })
    .setInputFiles([
      resolve('public/store-screenshot-create.png'),
      resolve('public/store-screenshot-inspiration.png'),
    ])
  await page.getByRole('button', { name: 'Add code', exact: true }).click()
  await page.getByRole('button', { name: 'Grid layout', exact: true }).click()
  await page.getByRole('button', { name: 'Design', exact: true }).click()
  await page.getByRole('button', { name: 'Step badge', exact: true }).click()
  await expect(page.getByRole('button', { name: /2 overlays Manage depth/ })).toBeVisible()
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  const selected = page
    .getByRole('tabpanel', { name: 'Layers', exact: true })
    .locator('[aria-pressed="true"]')
  await expect(selected).toHaveCount(1)
  await expect(selected).toContainText('Step badge 1')
  await page.getByRole('button', { name: 'BG', exact: true }).click()
  const swatches = page.getByRole('button', { name: /^(Magic gradient|Gradient|Mesh gradient) / })
  await expect(swatches).toHaveCount(222)
  await swatches.first().click()
  await expect(swatches.first()).toHaveAttribute('aria-pressed', 'true')
  await swatches.last().click()
  await expect(swatches.first()).toHaveAttribute('aria-pressed', 'false')
  await expect(swatches.last()).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Save as project', exact: true }).click()
  await page.getByLabel('Project name', { exact: true }).fill('Image composition regression')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Project Image composition regression: Saved' })
  ).toBeVisible({ timeout: 30_000 })
  const projectId = new URL(page.url()).searchParams.get('project')
  expect(projectId).toBeTruthy()
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Project Image composition regression: Saved' })
  ).toBeVisible({ timeout: 30_000 })
  await expect(canvas(page).locator('[data-device-id]')).toHaveCount(4)
  await expect(text(page)).toHaveText('Cloud composition QA')
  await expect(canvas(page).locator('[data-element-id]')).toHaveCount(1)
  const images = canvas(page).locator('img[alt="Device screen"]')
  await expect(images).toHaveCount(3)
  await expect
    .poll(() =>
      images.evaluateAll((nodes) =>
        nodes.every((node) => (node as HTMLImageElement).naturalWidth > 0)
      )
    )
    .toBe(true)
})

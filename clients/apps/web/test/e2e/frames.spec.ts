import { chooseOption } from './framework/browser'
import { readFile } from 'node:fs/promises'
import type { Download, Locator, Page } from '@playwright/test'
import { signUpAndCreateWorkspace } from './framework/auth'
import { configureE2EFlow, expect, test } from './framework/flow'

configureE2EFlow()

const SCREENSHOTS = [
  'public/demo/notion-showcase.webp',
  'public/demo/demo-2.png',
  'public/demo/demo-checkout-9x16.jpg',
]

/** Mean absolute RGB difference (0–1) between two images, drawn at the same size over black. */
async function imageDifference(page: Page, first: string, second: string): Promise<number> {
  return page.evaluate(
    async ({ first, second }) => {
      const width = 320
      const height = 240
      const pixels = async (src: string) => {
        const blob = await (await fetch(src)).blob()
        const bitmap = await createImageBitmap(blob)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        context.fillStyle = '#000'
        context.fillRect(0, 0, width, height)
        context.drawImage(bitmap, 0, 0, width, height)
        return context.getImageData(0, 0, width, height).data
      }
      const [a, b] = await Promise.all([pixels(first), pixels(second)])
      let total = 0
      for (let index = 0; index < a.length; index += 4) {
        total +=
          Math.abs(a[index]! - b[index]!) +
          Math.abs(a[index + 1]! - b[index + 1]!) +
          Math.abs(a[index + 2]! - b[index + 2]!)
      }
      return total / ((a.length / 4) * 3 * 255)
    },
    { first, second }
  )
}

const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`

/** Width and height from a PNG's IHDR chunk, after checking its signature. */
function pngSize(png: Buffer) {
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { height: png.readUInt32BE(20), width: png.readUInt32BE(16) }
}

async function exportPng(page: Page): Promise<Buffer> {
  await page.getByRole('button', { exact: true, name: 'Export' }).click()
  await page.getByRole('button', { exact: true, name: 'PNG' }).click()
  const exportButton = page.getByRole('button', { name: 'Export as PNG' })
  await expect(exportButton).toBeVisible()
  const download: Promise<Download> = page.waitForEvent('download')
  await exportButton.click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/\.png$/)
  const png = await readFile((await file.path())!)
  await page.keyboard.press('Escape')
  return png
}

/** The rendered preview image inside a layout button, once it has rendered. */
async function thumbnail(button: Locator): Promise<string> {
  await button.scrollIntoViewIfNeeded()
  const image = button.locator('img')
  await expect(image).toHaveAttribute('src', /^data:image\//, { timeout: 60_000 })
  return (await image.getAttribute('src'))!
}

/** The preview once it has changed from `previous` and stopped changing (edits are debounced). */
async function nextThumbnail(button: Locator, previous: string): Promise<string> {
  const image = button.locator('img')
  let last = previous
  let stableSince = 0
  await expect
    .poll(
      async () => {
        const src = await image.getAttribute('src')
        if (src !== last) {
          last = src ?? ''
          stableSince = Date.now()
        }
        return (
          last !== previous && last.startsWith('data:image/') && Date.now() - stableSince > 2_500
        )
      },
      { intervals: [500], timeout: 90_000 }
    )
    .toBe(true)
  return last
}

test('framed screenshots compose, preview, and export the same everywhere (Workflow F)', async ({
  identity,
  page,
}) => {
  test.setTimeout(480_000)
  await signUpAndCreateWorkspace(identity, page)
  await expect(
    page.getByText('Drag & drop, click to browse, or paste', { exact: true })
  ).toBeVisible()

  const stage = page.locator('#image-render-card')
  const screens = stage.locator('[data-device-id]')
  const framePanel = page.getByRole('tabpanel', { name: 'Frame' })
  const deselect = async () => {
    await page.keyboard.press('Escape')
    await expect(page.getByText('Editing Screenshot')).toBeVisible()
  }

  // 1. Three screenshots, laid out as a bento.
  await page.getByRole('button', { exact: true, name: 'Frame' }).first().click()
  const chooser = page.waitForEvent('filechooser')
  await framePanel.getByRole('button', { name: 'Add screenshots' }).click()
  await (await chooser).setFiles(SCREENSHOTS)
  await expect(screens).toHaveCount(3)
  const bento = framePanel.getByRole('button', { name: 'Bento layout' })
  await bento.click()
  await expect(bento).toHaveAttribute('aria-pressed', 'true')
  const sizes = await screens.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().width)
  )
  expect(sizes[0]).toBeGreaterThan(Math.max(sizes[1]!, sizes[2]!))

  // 2. One screenshot is selected and edited on its own.
  const second = screens.nth(1)
  const secondId = await second.getAttribute('data-device-id')
  await second.click()
  await expect(page.getByText('Editing Screen')).toBeVisible()
  await page.getByRole('button', { name: 'Bring to front' }).click()
  await expect(screens.last()).toHaveAttribute('data-device-id', secondId!)
  const opacity = page.getByRole('slider', { name: 'Opacity' })
  await opacity.focus()
  for (let step = 0; step < 30; step++) await page.keyboard.press('ArrowLeft')
  await expect
    .poll(() =>
      stage
        .locator(`[data-device-id="${secondId}"]`)
        .evaluate((node) => Number((node as HTMLElement).style.opacity))
    )
    .toBeLessThan(0.8)
  await expect
    .poll(() => screens.first().evaluate((node) => Number((node as HTMLElement).style.opacity)))
    .toBe(1)
  await opacity.focus()
  for (let step = 0; step < 30; step++) await page.keyboard.press('ArrowRight')

  // Reorder by dragging in Layers: the top row goes to the bottom.
  await page.getByRole('button', { exact: true, name: 'Layers' }).first().click()
  const rows = page.locator('[data-screen-layer]')
  await expect(rows).toHaveCount(3)
  await rows.first().dragTo(rows.last())
  await expect(screens.first()).toHaveAttribute('data-device-id', secondId!)
  await expect(rows.last()).toHaveAttribute('data-screen-layer', secondId!)

  // 3. A browser frame on every screen.
  await page.getByRole('button', { exact: true, name: 'Frame' }).first().click()
  await deselect()
  await expect(framePanel.getByText('all 3 screens')).toBeVisible()
  const before = await thumbnail(bento)
  // Choosing a frame kind browses its options; applying it frames the screens.
  await framePanel.getByRole('button', { name: 'Browser frame' }).click()
  await framePanel.getByRole('button', { exact: true, name: 'Apply browser frame' }).click()
  await expect(stage.locator('[data-frame-box="browser"]')).toHaveCount(3)
  await framePanel.getByRole('button', { exact: true, name: 'Light' }).click()
  await expect(stage.locator('[data-frame-box="browser"][data-tone="light"]')).toHaveCount(3)
  await expect(stage.locator('[data-frame-chrome="chrome"]')).toHaveCount(3)

  // 4. Layout thumbnails show the frame: the preview is redrawn with it.
  const framed = await nextThumbnail(bento, before)

  // 5. A darker theme reaches the canvas and the thumbnails.
  await framePanel.getByRole('button', { exact: true, name: 'Dark' }).click()
  await expect(stage.locator('[data-frame-box="browser"][data-tone="dark"]')).toHaveCount(3)
  const dark = await nextThumbnail(bento, framed)

  // 6. The export matches the editor, and the thumbnail matches both.
  await deselect()
  await page.mouse.move(0, 0)
  const editorCapture = dataUrl(await stage.screenshot({ animations: 'disabled' }))
  const exported = await exportPng(page)
  const { height, width } = pngSize(exported)
  expect(Math.abs(width / height - 4 / 3)).toBeLessThan(0.01)
  const exportUrl = dataUrl(exported)
  expect(await imageDifference(page, editorCapture, exportUrl)).toBeLessThan(0.04)
  const thumbnailToExport = await imageDifference(page, dark, exportUrl)
  expect(thumbnailToExport).toBeLessThan(0.06)
  // The unframed preview is further from the framed export than the framed one.
  expect(await imageDifference(page, before, exportUrl)).toBeGreaterThan(thumbnailToExport)

  // 7. Code as a screenshot, in a terminal window, exported like everything else.
  await page.getByRole('button', { exact: true, name: 'Frame' }).first().click()
  await framePanel.getByRole('button', { name: 'Add code' }).click()
  await expect(screens).toHaveCount(4)
  const code = page.getByLabel('Code', { exact: true })
  await code.fill('$ npm run ship\n✓ Built in 1.2s\n✓ Published to x, linkedin')
  await chooseOption(page.getByLabel('Language'), 'Terminal session')
  await page.getByRole('button', { exact: true, name: 'Frame' }).first().click()
  await expect(framePanel.getByText('code in macos window')).toBeVisible()
  await framePanel.getByRole('button', { exact: true, name: 'macOS Terminal' }).click()
  const terminal = stage.locator('[data-frame-chrome="terminal-macos"]')
  await expect(terminal).toHaveCount(1)
  await expect(stage.locator('[data-code-screen]')).toContainText('Published to x, linkedin')
  await deselect()
  const codeExport = await exportPng(page)
  const codeSize = pngSize(codeExport)
  expect(codeSize.width).toBe(width)
  expect(await imageDifference(page, exportUrl, dataUrl(codeExport))).toBeGreaterThan(0.002)
})

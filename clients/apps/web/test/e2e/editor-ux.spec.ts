import type { Page } from '@playwright/test'
import { signUpAndCreateWorkspace } from './framework/auth'
import { configureE2EFlow, expect, test } from './framework/flow'

configureE2EFlow()

const UPLOAD_PROMPT = 'Drag & drop, click to browse, or paste'

/** Dispatch a paste or drop carrying several images, as a file manager would. */
async function dispatchImages(page: Page, type: 'drop' | 'paste', selector: string, count: number) {
  await page.evaluate(
    async ({ count, selector, type }) => {
      const data = new DataTransfer()
      for (let index = 0; index < count; index++) {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 64
        canvas.getContext('2d')!.fillRect(0, 0, 32 + index, 32)
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((png) => resolve(png!)))
        data.items.add(new File([blob], `image-${index}.png`, { type: 'image/png' }))
      }
      const target = document.querySelector(selector) ?? document.body
      const init = { bubbles: true, cancelable: true }
      target.dispatchEvent(
        type === 'paste'
          ? new ClipboardEvent('paste', { ...init, clipboardData: data })
          : new DragEvent('drop', { ...init, dataTransfer: data })
      )
    },
    { count, selector, type }
  )
}

const mainImage = (page: Page) => page.locator('img[alt="Main image"]')
const layers = (page: Page) => page.locator('[data-overlay-id]')

test('one paste creates exactly one image, and each paste is one undo step', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  await expect(page.getByText(UPLOAD_PROMPT, { exact: true })).toBeVisible()

  // ⌘V fires this paste event; headless macOS Chromium has no menu to map
  // the shortcut, so the spec dispatches the event the shortcut produces.
  // A paste on the empty canvas makes the main image, and nothing else.
  await dispatchImages(page, 'paste', 'body', 1)
  await expect(mainImage(page)).toHaveCount(1)
  await expect(layers(page)).toHaveCount(0)
  await expect(page.getByRole('button', { exact: true, name: 'Delete slide' })).toHaveCount(0)

  // A second paste adds one layer over the composition.
  await dispatchImages(page, 'paste', 'body', 1)
  await expect(layers(page)).toHaveCount(1)
  await expect(mainImage(page)).toHaveCount(1)

  // Pasting three files at once adds three layers, undone together.
  await dispatchImages(page, 'paste', 'body', 3)
  await expect(layers(page)).toHaveCount(4)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(layers(page)).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(layers(page)).toHaveCount(4)
})

test('a drop on the upload area is imported once', async ({ identity, page }) => {
  await signUpAndCreateWorkspace(identity, page)
  await expect(page.getByText(UPLOAD_PROMPT, { exact: true })).toBeVisible()
  await dispatchImages(page, 'drop', '[data-local-dropzone]', 1)
  await expect(mainImage(page)).toHaveCount(1)
  // The global drop handler used to import the same drop again as a layer.
  await page.waitForTimeout(600)
  await expect(layers(page)).toHaveCount(0)
})

test('Start over asks first, by mouse or keyboard, and Remove can be undone', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  await dispatchImages(page, 'drop', '[data-local-dropzone]', 1)
  await expect(mainImage(page)).toHaveCount(1)
  await page.getByRole('button', { exact: true, name: 'Add Text' }).first().click()
  const text = page.locator('[data-text-overlay-id]')
  await expect(text).toHaveCount(1)

  // Escape cancels and keeps the design.
  await page.getByRole('button', { exact: true, name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Start over' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Start over?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(text).toHaveCount(1)

  // Cancel by mouse also keeps it.
  await page.getByRole('button', { exact: true, name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Start over' }).click()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(text).toHaveCount(1)

  // Confirming by keyboard resets the design and keeps the screenshot.
  await page.getByRole('button', { exact: true, name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Start over' }).click()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Start over' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(text).toHaveCount(0)
  await expect(mainImage(page)).toHaveCount(1)

  // Remove takes only the screenshot, and its toast undoes it.
  await page.getByRole('button', { exact: true, name: 'Remove screenshot' }).click()
  await expect(mainImage(page)).toHaveCount(0)
  await page.getByRole('button', { exact: true, name: 'Undo' }).click()
  await expect(mainImage(page)).toHaveCount(1)
})

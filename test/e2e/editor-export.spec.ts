import { signUpAndCreateWorkspace } from './framework/auth'
import { configureE2EFlow, expect, test } from './framework/flow'

configureE2EFlow()

const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFgAI/ScL6fQAAAABJRU5ErkJggg==',
  'base64'
)

async function uploadImage(page: Parameters<typeof signUpAndCreateWorkspace>[1]) {
  const fileChooser = page.waitForEvent('filechooser')
  await page.getByText('Drag & drop, click to browse, or paste', { exact: true }).click()
  await (
    await fileChooser
  ).setFiles({
    buffer: image,
    mimeType: 'image/png',
    name: 'editor-e2e.png',
  })
  await expect(page.getByRole('button', { exact: true, name: 'Save' })).toBeEnabled()
}

test('an authenticated user can upload an image and export a PNG', async ({ identity, page }) => {
  await signUpAndCreateWorkspace(identity, page)
  await uploadImage(page)

  const save = page.getByRole('button', { exact: true, name: 'Save' })
  await save.click()
  await page.getByRole('button', { exact: true, name: 'PNG' }).click()
  const exportButton = page.getByRole('button', { name: 'Export as PNG' })
  await expect(exportButton).toBeVisible()

  const download = page.waitForEvent('download')
  await exportButton.click()
  expect((await download).suggestedFilename()).toMatch(/\.png$/)
})

test('an authenticated user can prepare a social aspect ratio, style it, and clear the draft', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  await uploadImage(page)

  await page.getByRole('button', { exact: true, name: '4:3' }).click()
  await page.getByRole('button', { name: /Post\s+1:1/ }).click()
  await expect(page.getByRole('banner').getByRole('button', { name: /1:1/ })).toBeVisible()

  await page.getByRole('button', { exact: true, name: 'BG' }).click()
  await expect(page.getByText('Custom Background', { exact: true })).toBeVisible()
  await page.getByRole('button', { exact: true, name: 'Transparent' }).click()

  await page.getByRole('button', { exact: true, name: 'Remove' }).click()
  await expect(
    page.getByText('Drag & drop, click to browse, or paste', { exact: true })
  ).toBeVisible()
})

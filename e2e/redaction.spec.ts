import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { createWorker } from 'tesseract.js'
import { signUpAndCreateWorkspace } from './framework/auth'
import { configureE2EFlow, expect, test } from './framework/flow'

configureE2EFlow()

const SECRETS = {
  card: '4242 4242 4242 4242',
  email: 'jane.doe@example.com',
  key: 'AKIAIOSFODNN7EXAMPLE',
}

/** Drop a generated "screenshot" with test secrets and a portrait onto the empty canvas. */
async function dropSensitiveScreenshot(page: Page) {
  const portrait = (
    await readFile(path.join(__dirname, 'fixtures/portrait-public-domain.jpg'))
  ).toString('base64')
  await page.evaluate(
    async ({ portrait, secrets }) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1400
      canvas.height = 800
      const context = canvas.getContext('2d')!
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#111111'
      context.font = '40px Arial, Helvetica, sans-serif'
      context.fillText(`Contact: ${secrets.email}`, 40, 120)
      context.fillText(`API key: ${secrets.key}`, 40, 220)
      context.fillText(`Card ${secrets.card}`, 40, 320)
      context.fillText('Dashboard settings and team overview', 40, 420)
      const face = new Image()
      face.src = `data:image/jpeg;base64,${portrait}`
      await face.decode()
      context.drawImage(face, 960, 140, 360, 464)
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((png) => resolve(png!), 'image/png')
      )
      const data = new DataTransfer()
      data.items.add(new File([blob], 'sensitive.png', { type: 'image/png' }))
      document
        .querySelector('[data-local-dropzone]')!
        .dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })
        )
    },
    { portrait, secrets: SECRETS }
  )
  await expect(page.locator('img[alt="Main image"]')).toHaveCount(1)
}

async function ocr(file: string): Promise<string> {
  const worker = await createWorker('eng')
  try {
    return (await worker.recognize(file)).data.text
  } finally {
    await worker.terminate()
  }
}

test('detected emails, keys, cards, and faces are reviewed, applied, and absent from exports', async ({
  identity,
  page,
}) => {
  test.setTimeout(300_000)
  await signUpAndCreateWorkspace(identity, page)
  await dropSensitiveScreenshot(page)

  await page.getByRole('button', { exact: true, name: 'Redact' }).click()
  await page.getByRole('button', { exact: true, name: 'Scan screenshot' }).click()
  const dialog = page.getByRole('dialog', { name: 'Redact sensitive information' })
  await expect(dialog).toBeVisible()
  const suggestions = dialog.getByRole('list', { name: 'Redaction suggestions' })
  // The engines download on first use, so the scan can take a while.
  await expect(suggestions.getByText('Email address')).toBeVisible({ timeout: 180_000 })
  await expect(suggestions.getByText('AWS access key')).toBeVisible()
  await expect(suggestions.getByText('Card number')).toBeVisible()
  await expect(suggestions.getByText('Face', { exact: true })).toBeVisible()
  await expect(suggestions.getByText(/Dashboard/)).toHaveCount(0)

  await dialog.getByRole('button', { name: 'Approve all' }).click()
  await dialog.getByRole('button', { exact: true, name: 'Cover' }).click()
  await dialog.getByRole('button', { name: /^Apply \d+ redactions?$/ }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { exact: true, name: 'Save' }).click()
  await page.getByRole('button', { exact: true, name: 'PNG' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export as PNG' }).click()
  const exported = await (await download).path()
  expect(exported).toBeTruthy()

  const text = (await ocr(exported!)).replace(/\s+/g, ' ')
  expect(text).toContain('Dashboard')
  expect(text).not.toContain(SECRETS.email)
  expect(text).not.toContain(SECRETS.key)
  expect(text.replace(/\s/g, '')).not.toContain(SECRETS.card.replace(/\s/g, ''))
})

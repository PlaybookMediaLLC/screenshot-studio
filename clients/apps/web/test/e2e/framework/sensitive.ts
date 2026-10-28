import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { createWorker } from 'tesseract.js'

/**
 * A generated screenshot with test secrets (an email, an AWS key, a card
 * number) and a public-domain portrait, for redaction and safe-publishing tests.
 */

/** Test secrets drawn into the screenshot. */
export const SECRETS = {
  card: '4242 4242 4242 4242',
  email: 'jane.doe@example.com',
  key: 'AKIAIOSFODNN7EXAMPLE',
}

/** Drop a generated "screenshot" with test secrets and a portrait onto the empty canvas. */
export async function dropSensitiveScreenshot(page: Page) {
  const portrait = (
    await readFile(path.join(__dirname, '../fixtures/portrait-public-domain.jpg'))
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

/** The text Tesseract reads in an image file. */
export async function ocr(file: string): Promise<string> {
  // Cache the language data outside the repository.
  const worker = await createWorker('eng', 1, { cachePath: tmpdir() })
  try {
    return (await worker.recognize(file)).data.text
  } finally {
    await worker.terminate()
  }
}

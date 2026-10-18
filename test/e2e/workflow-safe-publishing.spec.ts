import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { signUpAndCreateWorkspace } from './framework/auth'
import { configureE2EFlow, expect, test } from './framework/flow'
import { dropSensitiveScreenshot, ocr, SECRETS } from './framework/sensitive'

configureE2EFlow()

/**
 * Workflow D, safe publishing: a screenshot with test emails, credentials,
 * a card number, and a face is scanned, reviewed, and redacted, then
 * published at a link. The published file is checked twice: by OCR outside
 * the app, and by the app's own detectors run on the downloaded file.
 */
test('Workflow D: redacted work publishes without the sensitive text or face', async ({
  browser,
  identity,
  page,
}) => {
  test.setTimeout(420_000)
  await signUpAndCreateWorkspace(identity, page)
  await dropSensitiveScreenshot(page)

  await page.getByRole('button', { exact: true, name: 'Redact' }).click()
  await page.getByRole('button', { exact: true, name: 'Scan screenshot' }).click()
  const dialog = page.getByRole('dialog', { name: 'Redact sensitive information' })
  const suggestions = dialog.getByRole('list', { name: 'Redaction suggestions' })
  await expect(suggestions.getByText('Email address')).toBeVisible({ timeout: 180_000 })
  await expect(suggestions.getByText('Face', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Approve all' }).click()
  await dialog.getByRole('button', { exact: true, name: 'Cover' }).click()
  await dialog.getByRole('button', { name: /^Apply \d+ redactions?$/ }).click()
  await expect(dialog).toBeHidden()

  // Publish a preview link.
  await page.getByRole('button', { exact: true, name: 'Share' }).click()
  const share = page.getByRole('dialog', { name: 'Share design' })
  await share.getByLabel('Title').fill('Redacted dashboard')
  await share.getByRole('button', { name: 'Publish link' }).click()
  const published = page.getByRole('dialog', { name: 'Published' })
  await expect(published).toBeVisible({ timeout: 60_000 })
  const url = await published.getByLabel('Link').inputValue()
  await published.getByRole('button', { name: 'Done' }).click()

  // Anyone with the link gets the flattened file: no secret text in it.
  const visitor = await browser.newContext()
  const media = await visitor.request.get(url.replace('/s/', '/api/share/') + '/media')
  expect(media.status()).toBe(200)
  const bytes = await media.body()
  const file = path.join(tmpdir(), `published-${Date.now()}.png`)
  await writeFile(file, bytes)
  const text = (await ocr(file)).replace(/\s+/g, ' ')
  expect(text).toContain('Dashboard')
  expect(text).not.toContain(SECRETS.email)
  expect(text).not.toContain(SECRETS.key)
  expect(text.replace(/\s/g, '')).not.toContain(SECRETS.card.replace(/\s/g, ''))
  await visitor.close()

  // The app's own detectors find nothing in the published file either.
  await page.getByRole('button', { exact: true, name: 'Remove' }).click()
  await expect(page.locator('img[alt="Main image"]')).toHaveCount(0)
  await page.locator('[data-local-dropzone]').waitFor()
  await page.evaluate(
    async (bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
      const data = new DataTransfer()
      data.items.add(new File([blob], 'published.png', { type: 'image/png' }))
      document
        .querySelector('[data-local-dropzone]')!
        .dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })
        )
    },
    [...bytes]
  )
  await expect(page.locator('img[alt="Main image"]')).toHaveCount(1)
  await page.getByRole('button', { exact: true, name: 'Scan screenshot' }).click()
  const progress = dialog.locator('[aria-live="polite"]')
  await expect(progress).toBeVisible()
  await expect(progress).toBeHidden({ timeout: 180_000 })
  await expect(suggestions.getByText('Email address')).toHaveCount(0)
  await expect(suggestions.getByText('AWS access key')).toHaveCount(0)
  await expect(suggestions.getByText('Card number')).toHaveCount(0)
  await expect(suggestions.getByText('Face', { exact: true })).toHaveCount(0)
})

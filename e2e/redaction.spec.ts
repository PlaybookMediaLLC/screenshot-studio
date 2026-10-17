import { signUpAndCreateWorkspace } from './framework/auth'
import { configureE2EFlow, expect, test } from './framework/flow'
import { dropSensitiveScreenshot, ocr, SECRETS } from './framework/sensitive'

configureE2EFlow()

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

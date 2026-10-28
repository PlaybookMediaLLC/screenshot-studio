import { apiRequest, expect, test } from './framework'

test(
  'bulk imports recover rejected rows and reconcile a lost response after reload',
  { tag: '@journey' },
  async ({ app, page, startWorkspace }) => {
    await startWorkspace({ channels: ['x', 'linkedin'] })
    await app.open('/write')
    await page.getByRole('button', { name: 'Bulk import', exact: true }).click()
    await page
      .getByLabel('Batch CSV', { exact: true })
      .fill('caption,asset,channels\nRejected draft,,x')
    await page.getByRole('button', { name: 'Review import', exact: true }).click()
    const requests: Record<string, unknown>[] = []
    let reject = true
    let loseResponse = false
    let acceptedId = ''
    await page.route('**/api/v1/content-drafts', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      requests.push(route.request().postDataJSON())
      if (reject) {
        reject = false
        return route.fulfill({ status: 422, json: { message: 'Review the rejected caption.' } })
      }
      if (loseResponse) {
        loseResponse = false
        const response = await route.fetch()
        expect(response.status()).toBe(201)
        acceptedId = (await response.json()).id
        return route.abort('failed')
      }
      return route.continue()
    })
    await page.getByRole('button', { name: 'Create remaining drafts' }).click()
    await expect(page.getByTestId('bulk-import')).toContainText('Review the rejected caption.')
    await expect(page.getByLabel('Caption for import row 1')).toBeDisabled()
    await page.getByRole('button', { name: 'Edit rejected row' }).click()
    await page.getByLabel('Caption for import row 1').fill('Corrected draft')
    await page.getByRole('button', { name: 'Create remaining drafts' }).click()
    await expect(page.getByRole('link', { name: 'Draft created' })).toHaveCount(1)
    expect(requests).toHaveLength(2)
    expect(requests[0].importKey).not.toBe(requests[1].importKey)
    expect(requests[1].plainText).toBe('Corrected draft')
    const firstURL = await page.getByRole('link', { name: 'Draft created' }).getAttribute('href')

    await page.getByRole('button', { name: 'Start a new batch' }).click()
    await page
      .getByLabel('Batch CSV', { exact: true })
      .fill('caption,asset,channels\nResponse lost,,x')
    await page.getByRole('button', { name: 'Review import', exact: true }).click()
    loseResponse = true
    await page.getByRole('button', { name: 'Create remaining drafts' }).click()
    await expect(page.getByTestId('bulk-import')).toContainText('outcome is unconfirmed')
    await expect(page.getByRole('button', { name: 'Start a new batch' })).toBeDisabled()
    await expect(page.getByLabel('Caption for import row 1')).toBeDisabled()
    expect(acceptedId).not.toBe('')
    const savedRequest = requests.at(-1)
    await app.reload()
    await page.getByRole('button', { name: 'Bulk import', exact: true }).click()
    await expect(page.getByTestId('bulk-import')).toContainText('Resumed this tab’s import')
    await page.getByRole('button', { name: 'Create remaining drafts' }).click()
    await expect(page.getByRole('link', { name: 'Draft created' })).toHaveAttribute(
      'href',
      `/write/${acceptedId}`
    )
    expect(requests.at(-1)).toEqual(savedRequest)
    expect(requests).toHaveLength(4)
    const persisted = await apiRequest(page, `/api/v1/content-drafts/${acceptedId}`)
    expect(persisted.status).toBe(200)
    expect((persisted.body as { plainText: string }).plainText).toBe('Response lost')
    const first = await apiRequest(page, `/api/v1/content-drafts/${firstURL!.split('/').at(-1)}`)
    expect((first.body as { plainText: string }).plainText).toBe('Corrected draft')
    await app.reload()
    await page.getByRole('button', { name: 'Bulk import', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Draft created' })).toHaveAttribute(
      'href',
      `/write/${acceptedId}`
    )
    await expect(page.getByRole('button', { name: 'Create remaining drafts' })).toBeDisabled()
  }
)

test(
  'bulk import refuses to send when its durable browser receipt cannot be saved',
  { tag: '@journey' },
  async ({ app, page, startWorkspace }) => {
    await startWorkspace({ channels: ['x', 'linkedin'] })
    await app.open('/write')
    await page.getByRole('button', { name: 'Bulk import', exact: true }).click()
    let creates = 0
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/api/v1/content-drafts'
      )
        creates++
    })
    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key.startsWith('shots:import:'))
          throw new DOMException('Browser storage is full.', 'QuotaExceededError')
        return original.call(this, key, value)
      }
    })
    await page
      .getByLabel('Batch CSV', { exact: true })
      .fill('caption,asset,channels\nKeep this text,,x')
    await page.getByRole('button', { name: 'Review import', exact: true }).click()
    await expect(page.getByText('Browser storage is full.', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Batch CSV', { exact: true })).toContainText('Keep this text')
    await expect(page.getByRole('button', { name: 'Create remaining drafts' })).toHaveCount(0)
    expect(creates).toBe(0)
  }
)

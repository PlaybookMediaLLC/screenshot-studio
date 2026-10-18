import { expect, test } from './flow'
import { mockBrowserJson } from './downstream'

test('browser mocks return JSON and record downstream calls', async ({ page }) => {
  const mock = await mockBrowserJson(page, '**/e2e-downstream-mock', {
    body: { accepted: true },
    method: 'POST',
    status: 201,
  })

  await page.goto('/sign-in')
  const response = await page.evaluate(async () => {
    const result = await fetch('/e2e-downstream-mock', {
      body: JSON.stringify({ source: 'e2e' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    return { body: await result.json(), status: result.status }
  })

  expect(response).toEqual({ body: { accepted: true }, status: 201 })
  mock.expectCalls()
  expect(mock.calls[0]).toMatchObject({
    method: 'POST',
    postData: JSON.stringify({ source: 'e2e' }),
  })
})

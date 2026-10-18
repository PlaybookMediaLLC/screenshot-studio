import { expect, type Page } from '@playwright/test'

export type BrowserJsonMockCall = {
  method: string
  postData: string | null
  url: string
}

export type BrowserJsonMock = {
  calls: readonly BrowserJsonMockCall[]
  expectCalls: (count?: number) => void
}

export type BrowserJsonMockOptions = {
  body: unknown
  method?: string
  status?: number
}

export async function mockBrowserJson(
  page: Page,
  url: string | RegExp,
  options: BrowserJsonMockOptions
): Promise<BrowserJsonMock> {
  const calls: BrowserJsonMockCall[] = []
  const expectedMethod = options.method?.toUpperCase()

  await page.route(url, async (route) => {
    const request = route.request()
    if (expectedMethod && request.method() !== expectedMethod) {
      await route.fallback()
      return
    }
    calls.push({ method: request.method(), postData: request.postData(), url: request.url() })
    await route.fulfill({
      body: JSON.stringify(options.body),
      contentType: 'application/json',
      status: options.status ?? 200,
    })
  })

  return {
    calls,
    expectCalls: (count = 1): void => {
      expect(calls).toHaveLength(count)
    },
  }
}

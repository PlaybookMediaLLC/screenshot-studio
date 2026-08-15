import type { Page } from '@playwright/test'

export type BrowserRequest = {
  body?: string
  headers?: Record<string, string>
  method?: string
}

type BrowserResponse = {
  body: unknown
  status: number
}

function toRequestInit(input: BrowserRequest): RequestInit {
  return {
    body: input.body,
    credentials: 'same-origin',
    headers: input.headers,
    method: input.method,
  }
}

export async function browserRequest(
  page: Page,
  path: string,
  input: BrowserRequest = {}
): Promise<BrowserResponse> {
  return page.evaluate(
    async ({ input: requestInput, requestPath }) => {
      const response = await fetch(requestPath, requestInput)
      const text = await response.text()
      if (!text) {
        return { body: null, status: response.status }
      }

      try {
        return { body: JSON.parse(text), status: response.status }
      } catch {
        return { body: text, status: response.status }
      }
    },
    { input: toRequestInit(input), requestPath: path }
  )
}

export async function browserJson(
  page: Page,
  path: string,
  input: BrowserRequest = {}
): Promise<unknown> {
  const response = await browserRequest(page, path, input)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request to ${path} failed with ${response.status}.`)
  }

  return response.body
}

export async function uploadSignedAsset(
  page: Page,
  uploadUrl: string,
  bytes: readonly number[],
  contentType: string
): Promise<number> {
  return page.evaluate(
    async ({ contentType: type, data, url }) => {
      const response = await fetch(url, {
        body: new Uint8Array(data),
        headers: { 'content-type': type },
        method: 'PUT',
      })
      return response.status
    },
    { contentType, data: [...bytes], url: uploadUrl }
  )
}

export async function downloadSignedAsset(
  page: Page,
  downloadUrl: string
): Promise<{ bytes: number; status: number }> {
  return page.evaluate(async (url) => {
    const response = await fetch(url)
    return { bytes: (await response.arrayBuffer()).byteLength, status: response.status }
  }, downloadUrl)
}

export async function requestJson(
  page: Page,
  path: string,
  body: unknown,
  method: 'POST' | 'PUT' | 'DELETE' = 'POST',
  headers: Record<string, string> = {}
): Promise<BrowserResponse> {
  return browserRequest(page, path, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
    method,
  })
}

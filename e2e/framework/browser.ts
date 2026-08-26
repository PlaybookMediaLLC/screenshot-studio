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
  // These requests run in the page so they carry the session cookie, which
  // means they share the page's execution context: any navigation still
  // settling when the fetch starts destroys that context and rejects with
  // "Execution context was destroyed", regardless of what the request would
  // have returned. The failure is indistinguishable from the endpoint
  // misbehaving, which is exactly the kind of false signal that makes a
  // tenant-isolation suite untrustworthy.
  //
  // Prevention first: wait for the page to stop navigating before evaluating.
  // That removes the common case without changing what is sent.
  await page.waitForLoadState('domcontentloaded').catch(() => {})

  const requestInit = toRequestInit(input)
  const method = (input.method ?? 'GET').toUpperCase()
  // Retry only reads. A destroyed context gives no way to tell whether the
  // request reached the server, so replaying a DELETE or POST could double
  // submit and turn a 202 into a 404 on the retry, inventing a failure worse
  // than the one being fixed. GET and HEAD have no such risk.
  const isReplaySafe = method === 'GET' || method === 'HEAD'
  const attempts = isReplaySafe ? 3 : 1
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await page.evaluate(
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
        { input: requestInit, requestPath: path }
      )
    } catch (error) {
      if (!isDestroyedContextError(error)) throw error
      lastError = error
      await page.waitForLoadState('domcontentloaded').catch(() => {})
    }
  }

  throw lastError
}

/**
 * True for the Playwright error raised when a navigation replaces the
 * execution context that `page.evaluate` was running in.
 */
function isDestroyedContextError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('Execution context was destroyed') ||
      error.message.includes('Target closed') ||
      error.message.includes('Target crashed'))
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

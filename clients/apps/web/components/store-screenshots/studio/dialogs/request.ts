/**
 * JSON requests from the studio's dialogs to the platform API. Errors
 * surface the server's message so the user sees why something failed.
 */

/** Send a JSON request and return the parsed response, or throw with the server's message. */
export async function requestJson<T>(url: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(url, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } | string; message?: string }
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : (data.error?.message ?? data.message)
    throw new Error(message ?? `The request failed (${response.status}).`)
  }
  return data
}

/** A blob as plain base64 (no data URL prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

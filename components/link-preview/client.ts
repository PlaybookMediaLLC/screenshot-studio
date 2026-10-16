import type { LinkPreview, LinkPreviewAgent } from '@/lib/api/contracts/link-preview'

/** The URL as typed, with `https://` added when no scheme was given; null when it is not a web URL. */
export function normalizeUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Ask the server to read `url` as `agent`. Throws with the API's message on failure. */
export async function requestPreview(
  url: string,
  agent: LinkPreviewAgent,
  signal?: AbortSignal
): Promise<LinkPreview> {
  const query = new URLSearchParams({ agent, url })
  const response = await fetch(`/api/v1/link-preview?${query}`, { signal })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.message ?? 'The page could not be read.')
  return body as LinkPreview
}

/** Copy `text`, reporting whether the browser allowed it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Save `blob` as a file named `name`. */
export function downloadBlob(name: string, blob: Blob) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}

/** Save `text` as a file named `name`. */
export function downloadText(name: string, text: string, type: string) {
  downloadBlob(name, new Blob([text], { type }))
}

import { z } from 'zod'

/**
 * Figma REST API access for screenshot import. The caller's personal
 * access token is used for the request and discarded. Rendered images are
 * only downloaded from Figma's own image hosts, checked to be PNG, and size
 * limited, so this cannot be used to fetch arbitrary URLs.
 */

const API = 'https://api.figma.com/v1'
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const IMAGE_HOSTS = [/^figma-alpha-api\.s3\.[a-z0-9-]+\.amazonaws\.com$/, /(^|\.)figma\.com$/, /(^|\.)figmausercontent\.com$/]

/** A Figma request failed in a way the user can act on. */
export class FigmaError extends Error {
  /** HTTP status to report. */
  readonly status: 400 | 403 | 404 | 429 | 503

  /** Create a Figma error. */
  constructor(message: string, status: FigmaError['status']) {
    super(message)
    this.name = 'FigmaError'
    this.status = status
  }
}

/** Fetch implementation, injectable for tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

async function figmaFetch(fetcher: FetchLike, url: string, token: string): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetcher(url, { headers: { 'X-Figma-Token': token }, signal: AbortSignal.timeout(20_000) })
    if (response.ok) return response
    if (response.status === 403) throw new FigmaError('The token cannot open this file. Check the token and that it can read file content.', 403)
    if (response.status === 404) throw new FigmaError('Figma could not find that file or frame.', 404)
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      const wait = Math.min(5, Number(response.headers.get('retry-after') ?? '1') || 1)
      await new Promise((resolve) => setTimeout(resolve, wait * 1000))
      continue
    }
    if (response.status === 429) throw new FigmaError('Figma is rate limiting requests. Try again in a minute.', 429)
    throw new FigmaError(`Figma answered with an error (${response.status}).`, 503)
  }
  throw new FigmaError('Figma is not responding.', 503)
}

const nodeSchema: z.ZodType<{ id: string; name: string; type: string; absoluteBoundingBox?: { width: number; height: number } | null; children?: unknown[] }> = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  absoluteBoundingBox: z.object({ width: z.number(), height: z.number() }).nullable().optional(),
  children: z.array(z.unknown()).optional(),
})

const FRAME_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET'])

/** Top-level frames on every page of a file. */
export async function listFigmaFrames(fileKey: string, token: string, fetcher: FetchLike = fetch) {
  const response = await figmaFetch(fetcher, `${API}/files/${encodeURIComponent(fileKey)}?depth=2`, token)
  const body = z.object({ document: z.object({ children: z.array(z.unknown()) }) }).safeParse(await response.json())
  if (!body.success) throw new FigmaError('Figma returned a file this importer does not understand.', 503)
  const frames: Array<{ id: string; name: string; page: string; width: number; height: number }> = []
  for (const rawPage of body.data.document.children) {
    const page = nodeSchema.safeParse(rawPage)
    if (!page.success) continue
    for (const rawChild of page.data.children ?? []) {
      const child = nodeSchema.safeParse(rawChild)
      if (!child.success || !FRAME_TYPES.has(child.data.type) || !child.data.absoluteBoundingBox) continue
      frames.push({ id: child.data.id, name: child.data.name.slice(0, 120), page: page.data.name.slice(0, 60), width: child.data.absoluteBoundingBox.width, height: child.data.absoluteBoundingBox.height })
    }
  }
  return frames.slice(0, 200)
}

/** Render one frame to PNG bytes. */
export async function renderFigmaFrame(fileKey: string, nodeId: string, token: string, scale: number, fetcher: FetchLike = fetch): Promise<Uint8Array> {
  const id = nodeId.replace('-', ':')
  const response = await figmaFetch(fetcher, `${API}/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(id)}&format=png&scale=${scale}`, token)
  const body = z.object({ err: z.string().nullable().optional(), images: z.record(z.string(), z.string().nullable()) }).safeParse(await response.json())
  const url = body.success ? body.data.images[id] : null
  if (!url) throw new FigmaError('Figma could not render that frame.', 404)
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !IMAGE_HOSTS.some((pattern) => pattern.test(parsed.hostname))) {
    throw new FigmaError('Figma returned an image from an unexpected address.', 503)
  }
  const image = await fetcher(parsed.toString(), { signal: AbortSignal.timeout(30_000) })
  if (!image.ok) throw new FigmaError('The rendered frame could not be downloaded.', 503)
  const length = Number(image.headers.get('content-length') ?? '0')
  if (length > MAX_IMAGE_BYTES) throw new FigmaError('The rendered frame is larger than 25 MB. Use a smaller scale.', 400)
  const bytes = new Uint8Array(await image.arrayBuffer())
  if (bytes.length > MAX_IMAGE_BYTES) throw new FigmaError('The rendered frame is larger than 25 MB. Use a smaller scale.', 400)
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) throw new FigmaError('Figma did not return a PNG.', 503)
  return bytes
}

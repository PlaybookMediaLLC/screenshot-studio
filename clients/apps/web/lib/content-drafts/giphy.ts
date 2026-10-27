import 'server-only'
import { safeFetchBytes, type SafeFetchOptions } from '@/lib/launch/safe-fetch'
import { z } from 'zod'

const rendition = z.object({ url: z.string().url(), width: z.string(), height: z.string() })
const gif = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  images: z.object({ fixed_height: rendition, original: rendition }),
})

/** Only activate after GIPHY explicitly approves server search and durable storage. */
export function giphyEnabled() {
  return (
    process.env.PLATFORM_GIPHY_APPROVED_API_AND_STORAGE === 'true' && !!process.env.GIPHY_API_KEY
  )
}

type GiphyTransport = { request?: typeof fetch; media?: SafeFetchOptions }

async function request(path: string, params: Record<string, string>, transport: GiphyTransport) {
  if (!giphyEnabled())
    throw new Error('GIPHY requires an approved API and durable storage integration.')
  const response = await (transport.request ?? fetch)(
    `https://api.giphy.com/v1/gifs/${path}?${new URLSearchParams({ ...params, api_key: process.env.GIPHY_API_KEY! })}`,
    { cache: 'no-store', signal: AbortSignal.timeout(10_000) }
  )
  if (response.status === 429) throw new Error('GIPHY search is rate limited. Try again later.')
  if (!response.ok) throw new Error('GIPHY is unavailable. Try again later.')
  return response.json() as Promise<unknown>
}

/** Small, attributed result records. Credentials never reach the browser. */
export async function searchGiphy(query: string, transport: GiphyTransport = {}) {
  const response = z
    .object({ data: z.array(gif).max(24) })
    .parse(await request('search', { q: query, limit: '24', rating: 'g' }, transport))
  return response.data.map((item) => ({
    id: item.id,
    title: item.title,
    previewUrl: item.images.fixed_height.url,
    sourceUrl: item.url,
  }))
}

/** Resolve the chosen ID again; the browser cannot select an arbitrary ingest URL. */
export async function selectedGiphy(id: string, transport: GiphyTransport = {}) {
  const { data } = z
    .object({ data: gif })
    .parse(await request(encodeURIComponent(id), {}, transport))
  if (data.id !== id) throw new Error('This GIF is no longer available. Search again.')
  const url = new URL(data.images.original.url)
  if (url.protocol !== 'https:' || !/^media\d*\.giphy\.com$/.test(url.hostname))
    throw new Error('This GIF has no supported source.')
  const image = await safeFetchBytes(url.toString(), { ...transport.media, maxBytes: 15_000_000 })
  if (
    !image.ok ||
    image.truncated ||
    image.contentType !== 'image/gif' ||
    !/^GIF8[79]a/.test(image.bytes.subarray(0, 6).toString())
  )
    throw new Error('This GIF cannot be attached. Choose another result.')
  return { body: image.bytes, sourceUrl: data.url }
}

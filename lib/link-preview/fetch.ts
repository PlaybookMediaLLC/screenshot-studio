import 'server-only'

import sharp from 'sharp'
import { z } from 'zod'
import {
  type LinkPreview,
  type LinkPreviewAgent,
  linkPreviewAgentSchema,
  type LinkPreviewImage,
  type LinkPreviewOembed,
} from '@/lib/api/contracts/link-preview'
import {
  allowedTestHosts,
  type FetchedText,
  safeFetchBytes,
  safeFetchText,
  safeProbe,
  type SafeFetchOptions,
} from '@/lib/launch/safe-fetch'
import { userAgentFor } from '@/lib/link-preview/crawlers'
import { oembedLink } from '@/lib/link-preview/extras'
import { parseLinkPreview } from '@/lib/link-preview/metadata'
import { crawlerAccess } from '@/lib/link-preview/robots'
import { parseSitemap, robotsSitemaps } from '@/lib/link-preview/sitemap'

const SIDE_TIMEOUT_MS = 5_000
const IMAGE_TIMEOUT_MS = 8_000
/** Facebook's limit, the largest of the platforms; anything bigger fails everywhere. */
const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const ROBOTS_MAX_BYTES = 500_000
const ROBOTS_SHOWN_CHARS = 20_000
const OEMBED_MAX_BYTES = 200_000
const MAX_HEADERS = 60

/** The oEmbed fields worth showing; everything else is ignored. */
const oembedResponseSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    provider_name: z.string(),
    author_name: z.string(),
    thumbnail_url: z.string(),
    width: z.coerce.number(),
    height: z.coerce.number(),
    html: z.string(),
  })
  .partial()

/** Response headers worth showing, without cookies, each value capped. */
function visibleHeaders(headers: Record<string, string | string[] | undefined> | undefined) {
  return Object.fromEntries(
    Object.entries(headers ?? {})
      .filter(([name, value]) => value !== undefined && !/cookie/i.test(name))
      .slice(0, MAX_HEADERS)
      .map(([name, value]) => [
        name,
        (Array.isArray(value) ? value.join(', ') : value!).slice(0, 500),
      ])
  )
}

/** What the page's oEmbed endpoint returns, read under the same SSRF checks. */
async function readOembed(url: string, options: SafeFetchOptions): Promise<LinkPreviewOembed> {
  const fetched = await safeFetchText(url, { ...options, maxBytes: OEMBED_MAX_BYTES })
  if (!fetched.ok) return { error: fetched.reason, url }
  try {
    const data = oembedResponseSchema.parse(JSON.parse(fetched.body))
    return {
      authorName: data.author_name,
      hasHtml: Boolean(data.html),
      height: data.height,
      providerName: data.provider_name,
      thumbnailUrl: data.thumbnail_url,
      title: data.title,
      type: data.type,
      url,
      width: data.width,
    }
  } catch {
    return { error: 'The oEmbed endpoint did not return valid JSON.', url }
  }
}

function header(headers: Record<string, string | string[] | undefined> | undefined, name: string) {
  const value = headers?.[name]
  return (Array.isArray(value) ? value.join(', ') : value) || undefined
}

/** Read an image's type, weight, and pixel size without decoding its pixels. */
async function inspectImage(url: string, options: SafeFetchOptions): Promise<LinkPreviewImage> {
  const fetched = await safeFetchBytes(url, {
    ...options,
    headers: { ...options.headers, accept: 'image/avif,image/webp,image/*;q=0.9,*/*;q=0.5' },
    maxBytes: IMAGE_MAX_BYTES,
    timeoutMs: IMAGE_TIMEOUT_MS,
  })
  if (!fetched.ok) return { url, error: fetched.reason }
  const image: LinkPreviewImage = {
    url,
    bytes: fetched.bytes.length,
    contentType: fetched.contentType || undefined,
    tooLarge: fetched.truncated || undefined,
  }
  try {
    const { format, height, width } = await sharp(fetched.bytes).metadata()
    return { ...image, format, height, width }
  } catch {
    return image
  }
}

/**
 * Read a public page's link metadata as `agent`, then in parallel: its
 * robots.txt and what it allows each crawler, its sitemap and favicon, and its
 * preview images. Every request goes through the SSRF-checked fetcher.
 */
export async function readLinkPreview(
  url: string,
  agent: LinkPreviewAgent
): Promise<{ ok: true; preview: LinkPreview } | Extract<FetchedText, { ok: false }>> {
  const options: SafeFetchOptions = {
    allowedPrivateHosts: allowedTestHosts(),
    headers: {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      'user-agent': userAgentFor(agent),
    },
  }
  const startedAt = performance.now()
  const page = await safeFetchText(url, options)
  if (!page.ok) return page
  const durationMs = Math.round(performance.now() - startedAt)

  const parsed = parseLinkPreview(page.body, page.url)
  const { origin } = new URL(page.url)
  const side = { ...options, timeoutMs: SIDE_TIMEOUT_MS }
  const found = async (path: string) =>
    (await safeProbe(`${origin}${path}`, side)) ? `${origin}${path}` : undefined
  const imageUrls = [...new Set([parsed.ogImage, parsed.twitterImage])].filter(
    (imageUrl): imageUrl is string => !!imageUrl
  )
  const oembedUrl = oembedLink(parsed)
  const [robots, sitemap, favicon, images, oembed] = await Promise.all([
    safeFetchText(`${origin}/robots.txt`, { ...side, maxBytes: ROBOTS_MAX_BYTES }),
    found('/sitemap.xml'),
    parsed.favicon ?? found('/favicon.ico'),
    Promise.all(imageUrls.map((imageUrl) => inspectImage(imageUrl, options))),
    oembedUrl ? readOembed(oembedUrl, side) : undefined,
  ])

  return {
    ok: true,
    preview: {
      ...parsed,
      agent,
      crawlers: crawlerAccess(robots.ok ? robots.body : '', page.url),
      favicon,
      images,
      oembed,
      response: {
        bytes: Buffer.byteLength(page.body),
        contentType: page.contentType,
        durationMs,
        hops: page.hops ?? [],
        truncated: page.truncated,
        xRobotsTag: header(page.headers, 'x-robots-tag'),
        headers: visibleHeaders(page.headers),
      },
      robotsFile: robots.ok ? robots.url : undefined,
      robotsTxt: robots.ok ? robots.body.slice(0, ROBOTS_SHOWN_CHARS) : undefined,
      sitemap,
    },
  }
}

const SITEMAP_MAX_BYTES = 5_000_000
/** Child sitemaps read from an index; enough to find the pages worth checking. */
const MAX_CHILD_SITEMAPS = 3
const MAX_SITEMAP_URLS = 500
/** A preview image that platforms take everywhere: the recommended size, as a JPEG under 600 KB. */
const OPTIMIZED = { height: 630, maxBytes: 600 * 1024, width: 1200 }
const SOURCE_IMAGE_MAX_BYTES = 20 * 1024 * 1024

function fetchOptions(): SafeFetchOptions {
  return {
    allowedPrivateHosts: allowedTestHosts(),
    headers: { 'user-agent': userAgentFor(linkPreviewAgentSchema.enum.default) },
    timeoutMs: SIDE_TIMEOUT_MS * 2,
  }
}

/**
 * The page URLs in a site's sitemap. `url` is a sitemap or any page on the
 * site; for a page, /sitemap.xml is tried, then the robots.txt Sitemap line.
 * A sitemap index is followed into its first few children.
 */
export async function readSitemap(
  url: string
): Promise<
  { ok: true; sitemap: string; total: number; urls: string[] } | Extract<FetchedText, { ok: false }>
> {
  const options = { ...fetchOptions(), maxBytes: SITEMAP_MAX_BYTES }
  const { origin, pathname } = new URL(url)
  let sitemapUrl = /\.xml$/i.test(pathname) ? url : `${origin}/sitemap.xml`
  let fetched = await safeFetchText(sitemapUrl, options)
  if (!fetched.ok && fetched.status === 'blocked') return fetched
  if (!fetched.ok || !parseSitemap(fetched.body).locs.length) {
    const robots = await safeFetchText(`${origin}/robots.txt`, options)
    const listed = robots.ok ? robotsSitemaps(robots.body)[0] : undefined
    if (!listed) {
      return {
        ok: false,
        reason: 'No sitemap was found at /sitemap.xml or in robots.txt.',
        status: 'failed',
      }
    }
    sitemapUrl = listed
    fetched = await safeFetchText(listed, options)
    if (!fetched.ok) return fetched
  }
  const parsed = parseSitemap(fetched.body)
  let urls = parsed.locs
  if (parsed.index) {
    const children = await Promise.all(
      parsed.locs.slice(0, MAX_CHILD_SITEMAPS).map((child) => safeFetchText(child, options))
    )
    urls = [
      ...new Set(children.flatMap((child) => (child.ok ? parseSitemap(child.body).locs : []))),
    ]
  }
  return {
    ok: true,
    sitemap: sitemapUrl,
    total: urls.length,
    urls: urls.slice(0, MAX_SITEMAP_URLS),
  }
}

/**
 * The image at `url` as a 1200 × 630 JPEG under 600 KB, cropped around its
 * most interesting region, so it fits every platform's large card.
 */
export async function optimizePreviewImage(
  url: string
): Promise<{ ok: true; image: Buffer } | Extract<FetchedText, { ok: false }>> {
  const fetched = await safeFetchBytes(url, { ...fetchOptions(), maxBytes: SOURCE_IMAGE_MAX_BYTES })
  if (!fetched.ok) return fetched
  if (fetched.truncated) {
    return { ok: false, reason: 'The image is over 20 MB, too large to convert.', status: 'failed' }
  }
  try {
    const resized = sharp(fetched.bytes, { limitInputPixels: 80_000_000 })
      .rotate()
      .resize(OPTIMIZED.width, OPTIMIZED.height, {
        fit: 'cover',
        position: sharp.strategy.attention,
      })
      .flatten({ background: '#ffffff' })
    let image = await resized.clone().jpeg({ mozjpeg: true, quality: 82 }).toBuffer()
    for (const quality of [72, 62]) {
      if (image.length <= OPTIMIZED.maxBytes) break
      image = await resized.clone().jpeg({ mozjpeg: true, quality }).toBuffer()
    }
    return { image, ok: true }
  } catch {
    return {
      ok: false,
      reason: 'The file is not an image that can be converted.',
      status: 'failed',
    }
  }
}

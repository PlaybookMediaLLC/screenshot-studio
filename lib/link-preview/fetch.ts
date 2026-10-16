import 'server-only'

import sharp from 'sharp'
import { z } from 'zod'
import {
  type CrawlerFetch,
  type LinkPreview,
  type LinkPreviewAgent,
  linkPreviewAgentSchema,
  type LinkPreviewImage,
  type LinkPreviewOembed,
  type LinkPreviewRendered,
  type LinkPreviewTarget,
  linkTargetKindSchema,
} from '@/lib/api/contracts/link-preview'
import {
  allowedTestHosts,
  type FetchedText,
  safeFetchBytes,
  safeFetchPage,
  safeFetchText,
  safeProbe,
  safeResolve,
  type SafeFetchOptions,
} from '@/lib/launch/safe-fetch'
import { detectChallenge, userAgentFor } from '@/lib/link-preview/crawlers'
import { oembedLink } from '@/lib/link-preview/extras'
import { parseLinkPreview } from '@/lib/link-preview/metadata'
import { crawlerAccess } from '@/lib/link-preview/robots'
import { parseSitemap, robotsSitemaps } from '@/lib/link-preview/sitemap'
import { assertPublicCaptureUrl } from '@/lib/screenshot-service'

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

/** The tags a tracking check adds to the shared link, then looks for at the end of the redirects. */
const TRACKING_TAGS = {
  utm_campaign: 'preview-check',
  utm_medium: 'link-preview',
  utm_source: 'screenshot-studio',
}

const comparable = (url: string) => url.replace(/#.*$/, '').replace(/\/$/, '')

/** Where the canonical and og:url lead, when they point anywhere but this page. */
async function readTargets(
  pageUrl: string,
  links: Array<[LinkPreviewTarget['kind'], string | undefined]>,
  options: SafeFetchOptions
): Promise<LinkPreviewTarget[]> {
  const seen = new Set([comparable(pageUrl)])
  const targets = links.filter((entry): entry is [LinkPreviewTarget['kind'], string] => {
    const [, url] = entry
    if (!url || seen.has(comparable(url))) return false
    seen.add(comparable(url))
    return true
  })
  return Promise.all(
    targets.map(async ([kind, url]) => {
      const resolved = await safeResolve(url, options)
      return resolved.ok
        ? { finalUrl: resolved.url, kind, status: resolved.status, url }
        : { error: resolved.reason, kind, url }
    })
  )
}

/** Share `url` with UTM tags and see whether they reach the page. */
async function readTracking(url: string, options: SafeFetchOptions) {
  const tagged = new URL(url)
  for (const [name, value] of Object.entries(TRACKING_TAGS)) tagged.searchParams.set(name, value)
  const resolved = await safeResolve(tagged.toString(), options)
  if (!resolved.ok) return { error: resolved.reason, url: tagged.toString() }
  return {
    finalUrl: resolved.url,
    kept: new URL(resolved.url).searchParams.get('utm_source') === TRACKING_TAGS.utm_source,
    url: tagged.toString(),
  }
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
  const { canonical: CANONICAL } = linkTargetKindSchema.enum
  const [robots, sitemap, favicon, images, oembed, targets, tracking] = await Promise.all([
    safeFetchText(`${origin}/robots.txt`, { ...side, maxBytes: ROBOTS_MAX_BYTES }),
    found('/sitemap.xml'),
    parsed.favicon ?? found('/favicon.ico'),
    Promise.all(imageUrls.map((imageUrl) => inspectImage(imageUrl, options))),
    oembedUrl ? readOembed(oembedUrl, side) : undefined,
    readTargets(
      page.url,
      [
        [CANONICAL, parsed.canonical],
        [linkTargetKindSchema.enum['og:url'], parsed.ogUrl],
      ],
      side
    ),
    readTracking(url, side),
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
      targets,
      tracking,
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

const MATRIX_MAX_BYTES = 400_000
const MATRIX_TIMEOUT_MS = 8_000

/**
 * The page as every crawler receives it, side by side: status, title, image,
 * and any bot protection that answered instead. Error statuses are kept,
 * because a 403 for one crawler is the finding.
 */
export async function readCrawlerMatrix(url: string): Promise<CrawlerFetch[]> {
  return Promise.all(
    linkPreviewAgentSchema.options.map(async (agent) => {
      const startedAt = performance.now()
      const page = await safeFetchPage(url, {
        allowedPrivateHosts: allowedTestHosts(),
        headers: {
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'user-agent': userAgentFor(agent),
        },
        maxBytes: MATRIX_MAX_BYTES,
        timeoutMs: MATRIX_TIMEOUT_MS,
      })
      const durationMs = Math.round(performance.now() - startedAt)
      if (!page.ok) return { agent, durationMs, error: page.reason }
      const parsed = parseLinkPreview(page.body, page.url)
      return {
        agent,
        challenge: detectChallenge(page.status, page.headers, page.body),
        durationMs,
        finalUrl: page.url,
        ogImage: parsed.ogImage,
        ogTitle: parsed.ogTitle,
        status: page.status,
        title: parsed.title,
        twitterCard: parsed.twitterCard,
      }
    })
  )
}

/** The headless browser the screenshot API already uses, which also returns rendered HTML. */
const RENDER_API_URL = process.env.SCREENSHOT_API_URL || 'https://api.microlink.io'

const renderResponseSchema = z.object({
  data: z.object({ head: z.string().nullish() }).partial().nullish(),
  message: z.string().optional(),
  status: z.string(),
})

/**
 * The page's preview tags after its JavaScript runs, read from the `<head>`
 * a headless browser rendered. Private addresses are refused before the URL
 * leaves the server, as they are for screenshots.
 */
export async function readRenderedHead(
  url: string
): Promise<{ ok: true; rendered: LinkPreviewRendered } | Extract<FetchedText, { ok: false }>> {
  try {
    assertPublicCaptureUrl(url)
  } catch {
    return { ok: false, reason: 'This address cannot be rendered.', status: 'blocked' }
  }
  const params = new URLSearchParams({
    'data.head.attr': 'html',
    'data.head.selector': 'head',
    meta: 'false',
    prerender: 'true',
    url,
  })
  let response: Response
  try {
    response = await fetch(`${RENDER_API_URL}/?${params}`, { signal: AbortSignal.timeout(30_000) })
  } catch {
    return { ok: false, reason: 'The page took too long to render.', status: 'failed' }
  }
  if (response.status === 429) {
    return {
      ok: false,
      reason: 'The rendering service is at its limit. Try again later.',
      status: 'failed',
    }
  }
  const body = renderResponseSchema.safeParse(await response.json().catch(() => null))
  const head = body.success ? body.data.data?.head : undefined
  if (!response.ok || !body.success || body.data.status !== 'success' || typeof head !== 'string') {
    return {
      ok: false,
      reason: (body.success && body.data.message) || 'The page could not be rendered.',
      status: 'failed',
    }
  }
  const parsed = parseLinkPreview(`<html><head>${head}</head></html>`, url)
  return {
    ok: true,
    rendered: {
      canonical: parsed.canonical,
      description: parsed.description,
      ogDescription: parsed.ogDescription,
      ogImage: parsed.ogImage,
      ogSiteName: parsed.ogSiteName,
      ogTitle: parsed.ogTitle,
      ogType: parsed.ogType,
      ogUrl: parsed.ogUrl,
      tagCount: parsed.tags.length,
      title: parsed.title,
      twitterCard: parsed.twitterCard,
      twitterDescription: parsed.twitterDescription,
      twitterImage: parsed.twitterImage,
      twitterTitle: parsed.twitterTitle,
    },
  }
}

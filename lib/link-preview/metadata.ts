import {
  type LinkPreview,
  type LinkPreviewTag,
  linkPreviewTagAttributeSchema,
} from '@/lib/api/contracts/link-preview'
import { decodeEntities } from '@/lib/launch/sanitize'

/**
 * Link metadata: read the tags that decide how a link unfurls, score them,
 * and print them back as HTML. Pure, so the route and the page share it.
 */

/** Character budgets that search results and social cards show before truncating. */
export const CHAR_LIMITS = {
  description: 160,
  ogDescription: 160,
  ogTitle: 60,
  title: 60,
  twitterDescription: 200,
  twitterTitle: 70,
} as const

// ponytail: tag scan by regex, not a DOM; enough for <meta>/<link>, swap in a parser if pages break it.
const NOT_MARKUP = /<!--[\s\S]*?-->|<(script|style|template|svg)\b[\s\S]*?<\/\1\s*>/gi
const TAG = /<(meta|link|html)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^'">])*)>/gi
const ATTRIBUTE = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const MAX_TAGS = 500
const FAVICON_RELS = [
  'icon',
  'shortcut icon',
  'apple-touch-icon',
  'apple-touch-icon-precomposed',
  'mask-icon',
  'fluid-icon',
]
const META_NAMES = ['name', 'property', 'http-equiv', 'itemprop'] as const
const JSON_LD =
  /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi
const { charset: CHARSET, rel: REL } = linkPreviewTagAttributeSchema.enum

function attributes(source: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const [, name, double, single, bare] of source.matchAll(ATTRIBUTE)) {
    const key = name!.toLowerCase()
    if (!result.has(key)) result.set(key, decodeEntities(double ?? single ?? bare ?? '').trim())
  }
  return result
}

function absolute(value: string, base: string): string {
  try {
    return new URL(value, base).toString()
  } catch {
    return value
  }
}

/** The schema.org `@type`s declared at the top of each JSON-LD block or its `@graph`. */
function jsonLdTypes(html: string): string[] {
  const types = new Set<string>()
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    for (const type of [record['@type']].flat()) if (typeof type === 'string') types.add(type)
    if (record['@graph']) visit(record['@graph'])
  }
  for (const [, body] of html.matchAll(JSON_LD)) {
    try {
      visit(JSON.parse(body!))
    } catch {
      // A broken block declares nothing a search engine can read.
    }
  }
  return [...types].slice(0, 20)
}

/** The fields a page's HTML alone decides; the server adds what it learns by fetching. */
export type ParsedLinkPreview = Omit<
  LinkPreview,
  'agent' | 'crawlers' | 'images' | 'response' | 'robotsFile' | 'sitemap'
>

/** Read the link metadata from a page's HTML. `pageUrl` resolves relative URLs. */
export function parseLinkPreview(html: string, pageUrl: string): ParsedLinkPreview {
  const markup = html.replace(NOT_MARKUP, ' ')
  const tags: LinkPreviewTag[] = []
  let language: string | undefined
  for (const [, element, source] of markup.matchAll(TAG)) {
    const attrs = attributes(source!)
    const kind = element!.toLowerCase()
    if (kind === 'html') {
      language ??= attrs.get('lang') || undefined
      continue
    }
    if (tags.length >= MAX_TAGS) continue
    if (kind === 'link') {
      const rel = attrs.get('rel')?.toLowerCase().replace(/\s+/g, ' ')
      const href = attrs.get('href')
      if (rel && href) {
        tags.push({
          attribute: REL,
          key: rel,
          value: absolute(href, pageUrl),
          hreflang: attrs.get('hreflang') || undefined,
          sizes: attrs.get('sizes') || undefined,
          type: attrs.get('type')?.toLowerCase() || undefined,
        })
      }
      continue
    }
    const charset = attrs.get('charset')
    if (charset) tags.push({ attribute: CHARSET, key: CHARSET, value: charset })
    const attribute = META_NAMES.find((name) => attrs.get(name))
    const content = attrs.get('content')
    if (attribute && content) tags.push({ attribute, key: attrs.get(attribute)!, value: content })
  }

  const meta = (key: string) =>
    tags.find((tag) => tag.attribute !== REL && tag.key.toLowerCase() === key)?.value
  const link = (...rels: string[]) =>
    tags.find((tag) => tag.attribute === REL && rels.includes(tag.key))?.value
  const url = (key: string) => {
    const value = meta(key)
    return value ? absolute(value, pageUrl) : undefined
  }
  const pageTitle = decodeEntities(markup.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const contentType = meta('content-type')?.match(/charset=([^;\s]+)/i)?.[1]

  return {
    url: pageUrl,
    title: pageTitle || meta('og:title') || meta('twitter:title'),
    description: meta('description'),
    canonical: link('canonical'),
    favicon: link(...FAVICON_RELS),
    language,
    charset: meta(CHARSET) ?? contentType,
    viewport: meta('viewport'),
    robots: meta('robots'),
    themeColor: meta('theme-color'),
    ogTitle: meta('og:title'),
    ogDescription: meta('og:description'),
    ogImage: url('og:image') ?? url('og:image:url') ?? url('og:image:secure_url'),
    ogImageAlt: meta('og:image:alt'),
    ogImageWidth: meta('og:image:width'),
    ogImageHeight: meta('og:image:height'),
    ogType: meta('og:type'),
    ogUrl: url('og:url'),
    ogSiteName: meta('og:site_name'),
    ogLocale: meta('og:locale'),
    twitterCard: meta('twitter:card'),
    twitterTitle: meta('twitter:title'),
    twitterDescription: meta('twitter:description'),
    twitterImage: url('twitter:image') ?? url('twitter:image:src'),
    twitterImageAlt: meta('twitter:image:alt'),
    twitterSite: meta('twitter:site'),
    twitterCreator: meta('twitter:creator'),
    jsonLd: jsonLdTypes(html),
    tags,
  }
}

/** One scored check: what is checked, whether it passed, and how much it counts. */
export type LinkPreviewCheck = { name: string; passed: boolean; weight: number }

const within = (value: string | undefined, min: number, max: number) =>
  !!value && value.length >= min && value.length <= max

/** Weighted checks and a 0 to 100 score for how completely a page describes itself. */
export function scoreLinkPreview(preview: LinkPreview): {
  checks: LinkPreviewCheck[]
  score: number
} {
  const checks: LinkPreviewCheck[] = [
    { name: 'Title', passed: !!preview.title, weight: 10 },
    { name: 'Description', passed: !!preview.description, weight: 10 },
    { name: 'OG Title', passed: !!preview.ogTitle, weight: 8 },
    { name: 'OG Description', passed: !!preview.ogDescription, weight: 8 },
    { name: 'OG Image', passed: !!preview.ogImage, weight: 12 },
    { name: 'Favicon', passed: !!preview.favicon, weight: 6 },
    { name: 'Canonical', passed: !!preview.canonical, weight: 6 },
    { name: 'Viewport', passed: !!preview.viewport, weight: 6 },
    { name: 'X Card', passed: !!preview.twitterCard, weight: 8 },
    { name: 'OG Type', passed: !!preview.ogType, weight: 6 },
    { name: 'OG Locale', passed: !!preview.ogLocale, weight: 4 },
    { name: 'robots.txt', passed: !!preview.robotsFile, weight: 2 },
    { name: 'sitemap.xml', passed: !!preview.sitemap, weight: 2 },
    { name: 'Title Length', passed: within(preview.title, 30, 60), weight: 4 },
    { name: 'Desc Length', passed: within(preview.description, 120, 160), weight: 4 },
  ]
  const total = checks.reduce((sum, check) => sum + check.weight, 0)
  const earned = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0)
  return { checks, score: Math.round((earned / total) * 100) }
}

const ESCAPES: Record<string, string> = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&#039;',
  '<': '&lt;',
  '>': '&gt;',
}
/** `value` safe inside HTML text and double-quoted attributes. */
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ESCAPES[char]!)

/** The page's title and tags as `<head>` markup, ready to copy. */
export function toMetaTagsHtml(preview: LinkPreview): string {
  const lines = preview.title ? [`<title>${escapeHtml(preview.title)}</title>`] : []
  for (const tag of preview.tags) {
    const { attribute, key, value } = tag
    if (attribute === REL) {
      const extra = (['hreflang', 'sizes', 'type'] as const)
        .map((name) => {
          const attributeValue = tag[name]
          return attributeValue ? ` ${name}="${escapeHtml(attributeValue)}"` : ''
        })
        .join('')
      lines.push(`<link rel="${escapeHtml(key)}"${extra} href="${escapeHtml(value)}">`)
    } else if (attribute === CHARSET) lines.push(`<meta charset="${escapeHtml(value)}">`)
    else lines.push(`<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(value)}">`)
  }
  return lines.join('\n')
}

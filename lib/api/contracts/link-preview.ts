import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'
import { workspaceDocs } from '@/lib/api/contracts/workspace-docs'

/** The attribute that names a `<meta>` or `<link>` tag; `rel` marks a `<link>`. */
export const linkPreviewTagAttributeSchema = z.enum([
  'charset',
  'http-equiv',
  'itemprop',
  'name',
  'property',
  'rel',
])

/** One `<meta>` or `<link>` tag from the page, in document order. */
export const linkPreviewTagSchema = z.object({
  attribute: linkPreviewTagAttributeSchema,
  /** The tag's name, such as `og:title` or `canonical`. */
  key: z.string(),
  /** The `content` or `charset` as written, or the absolute `href`. */
  value: z.string(),
  /** On a `<link>`: the language of an alternate. */
  hreflang: z.string().optional(),
  /** On a `<link>`: an icon's sizes, such as `180x180`. */
  sizes: z.string().optional(),
  /** On a `<link>`: the linked resource's media type. */
  type: z.string().optional(),
})

/** One of {@link linkPreviewTagSchema}. */
export type LinkPreviewTag = z.infer<typeof linkPreviewTagSchema>

/**
 * Who the page is requested as. Sites can answer each platform's crawler
 * differently, so fetching as one shows what that platform sees.
 */
export const linkPreviewAgentSchema = z.enum([
  'default',
  'facebook',
  'x',
  'linkedin',
  'slack',
  'discord',
  'telegram',
  'whatsapp',
  'google',
])

/** One of {@link linkPreviewAgentSchema}. */
export type LinkPreviewAgent = z.infer<typeof linkPreviewAgentSchema>

/** The platform crawlers, without the default browser-like agent. */
export const linkPreviewCrawlerSchema = linkPreviewAgentSchema.exclude(['default'])

/** One of {@link linkPreviewCrawlerSchema}. */
export type LinkPreviewCrawler = z.infer<typeof linkPreviewCrawlerSchema>

/** A preview image as the server read it. Only `url` and `error` are set when it failed. */
export const linkPreviewImageSchema = z.object({
  url: z.string(),
  error: z.string().optional(),
  contentType: z.string().optional(),
  /** Bytes read; a floor when `tooLarge` is set. */
  bytes: z.int().nonnegative().optional(),
  /** Bigger than the 8 MB read cap, which is over every platform's limit. */
  tooLarge: z.boolean().optional(),
  format: z.string().optional(),
  width: z.int().optional(),
  height: z.int().optional(),
})

/** One of {@link linkPreviewImageSchema}. */
export type LinkPreviewImage = z.infer<typeof linkPreviewImageSchema>

/** Whether robots.txt lets a platform's crawler read the page, and the rule that decided. */
export const linkPreviewCrawlerAccessSchema = z.object({
  crawler: linkPreviewCrawlerSchema,
  allowed: z.boolean(),
  rule: z.string().optional(),
})

/** One of {@link linkPreviewCrawlerAccessSchema}. */
export type LinkPreviewCrawlerAccess = z.infer<typeof linkPreviewCrawlerAccessSchema>

/** How the page answered: its redirect chain, timing, and indexing header. */
export const linkPreviewResponseSchema = z.object({
  /** Every response on the way, redirects first and the page last. */
  hops: z.array(z.object({ status: z.int(), url: z.string() })),
  durationMs: z.int().nonnegative(),
  contentType: z.string(),
  bytes: z.int().nonnegative(),
  /** The HTML was longer than the read cap; tags past it were not read. */
  truncated: z.boolean(),
  xRobotsTag: z.string().optional(),
  /** The page's response headers, without cookies. */
  headers: z.record(z.string(), z.string()).optional(),
})

/** What the page's oEmbed endpoint says about it, for Slack, Discord, Notion, and WordPress embeds. */
export const linkPreviewOembedSchema = z.object({
  url: z.string(),
  error: z.string().optional(),
  type: z.string().optional(),
  title: z.string().optional(),
  providerName: z.string().optional(),
  authorName: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  /** Whether it returns embeddable HTML, as video and rich types do. */
  hasHtml: z.boolean().optional(),
})

/** One of {@link linkPreviewOembedSchema}. */
export type LinkPreviewOembed = z.infer<typeof linkPreviewOembedSchema>

/** Which link on the page a target check followed. */
export const linkTargetKindSchema = z.enum(['canonical', 'og:url'])

/** Where the page's canonical or og:url actually leads. */
export const linkPreviewTargetSchema = z.object({
  kind: linkTargetKindSchema,
  url: z.string(),
  /** The final status after redirects. */
  status: z.int().optional(),
  finalUrl: z.string().optional(),
  error: z.string().optional(),
})

/** One of {@link linkPreviewTargetSchema}. */
export type LinkPreviewTarget = z.infer<typeof linkPreviewTargetSchema>

/** Whether UTM tags on the shared link survive the redirects to the page. */
export const linkPreviewTrackingSchema = z.object({
  /** The link as shared, with test UTM tags. */
  url: z.string(),
  finalUrl: z.string().optional(),
  kept: z.boolean().optional(),
  error: z.string().optional(),
})

const text = z.string().optional()

/** The metadata that decides how a link unfurls on social platforms. URLs are absolute. */
export const linkPreviewSchema = z.object({
  /** The page that was read, after redirects. */
  url: z.string(),
  title: text,
  description: text,
  canonical: text,
  favicon: text,
  language: text,
  charset: text,
  viewport: text,
  robots: text,
  themeColor: text,
  ogTitle: text,
  ogDescription: text,
  ogImage: text,
  ogImageAlt: text,
  /** `og:image:width` and `og:image:height` as declared, not as measured. */
  ogImageWidth: text,
  ogImageHeight: text,
  ogType: text,
  ogUrl: text,
  ogSiteName: text,
  ogLocale: text,
  twitterCard: text,
  twitterTitle: text,
  twitterDescription: text,
  twitterImage: text,
  twitterImageAlt: text,
  twitterSite: text,
  twitterCreator: text,
  /** The site's `/robots.txt` URL, when it answers. */
  robotsFile: text,
  /** The site's `/sitemap.xml` URL, when it answers. */
  sitemap: text,
  /** The schema.org types the page declares in JSON-LD. */
  jsonLd: z.array(z.string()),
  tags: z.array(linkPreviewTagSchema),
  /** Set by the server; absent on previews built from HTML alone. */
  agent: linkPreviewAgentSchema.optional(),
  response: linkPreviewResponseSchema.optional(),
  images: z.array(linkPreviewImageSchema).optional(),
  crawlers: z.array(linkPreviewCrawlerAccessSchema).optional(),
  /** The robots.txt file, cut at 20,000 characters. */
  robotsTxt: z.string().optional(),
  targets: z.array(linkPreviewTargetSchema).optional(),
  tracking: linkPreviewTrackingSchema.optional(),
  oembed: linkPreviewOembedSchema.optional(),
})

/** One of {@link linkPreviewSchema}. */
export type LinkPreview = z.infer<typeof linkPreviewSchema>

/** How much an issue costs: a broken preview, a weaker one, or a missed extra. */
export const issueSeveritySchema = z.enum(['error', 'warning', 'info'])

/** One of {@link issueSeveritySchema}. */
export type IssueSeverity = z.infer<typeof issueSeveritySchema>

/** Where an issue lives on the page. */
export const issueCategorySchema = z.enum(['content', 'social', 'images', 'indexing', 'technical'])

/** One problem with the page's preview and how to fix it. */
export const linkPreviewIssueSchema = z.object({
  id: z.string(),
  severity: issueSeveritySchema,
  category: issueCategorySchema,
  title: z.string(),
  fix: z.string(),
})

/** One of {@link linkPreviewIssueSchema}. */
export type LinkPreviewIssue = z.infer<typeof linkPreviewIssueSchema>

/** A check as the API returns it: the preview, its 0 to 100 score, and its issues, errors first. */
export const linkPreviewReportSchema = linkPreviewSchema.extend({
  score: z.int().min(0).max(100),
  issues: z.array(linkPreviewIssueSchema),
})

/** One of {@link linkPreviewReportSchema}. */
export type LinkPreviewReport = z.infer<typeof linkPreviewReportSchema>

/**
 * `GET /api/v1/link-preview`: read a public page as a platform crawler and
 * report how its link previews. Served to the signed-in app and to API keys.
 */
export const getLinkPreviewContract = defineContract({
  access: { apiKeyScope: 'artifact:read', permission: 'artifact:read' },
  docs: workspaceDocs({
    description:
      'Reads a public page as the chosen crawler and reports how its links preview: every meta tag, the measured preview images, robots.txt access for each platform crawler, the redirect chain, a 0 to 100 score, and each issue with its fix. Run it in CI to fail a deploy whose links would preview badly. Requires the `artifact:read` scope.',
    operationId: 'getLinkPreview',
    outputName: 'LinkPreviewReport',
    responses: {
      '200': 'The check.',
      '400': 'The URL is invalid, private, or not on a standard web port.',
      '422': 'The page could not be read: it timed out, errored, or is not HTML.',
      '429': 'Too many checks for this workspace; retry after the reset.',
    },
    tag: 'Workspace',
  }),
  method: 'GET',
  name: 'link-preview.get',
  output: linkPreviewReportSchema,
  path: '/api/v1/link-preview',
  query: z.object({
    url: z.url({ protocol: /^https?$/ }).max(2048),
    agent: linkPreviewAgentSchema.default(linkPreviewAgentSchema.enum.default),
  }),
  summary: 'Check how a link previews',
})

/** One AI-written title and description for sharing a page, and the angle it takes. */
export const linkCopyVariantSchema = z.object({
  angle: z.string().min(1).max(60),
  title: z.string().min(1).max(70),
  description: z.string().min(1).max(200),
})

/** One of {@link linkCopyVariantSchema}. */
export type LinkCopyVariant = z.infer<typeof linkCopyVariantSchema>

/** `POST /api/link-preview/suggestions`: three title and description options written from the page. */
export const suggestLinkCopyContract = defineContract({
  body: z.object({
    url: z.url({ protocol: /^https?$/ }).max(2048),
    agent: linkPreviewAgentSchema.default(linkPreviewAgentSchema.enum.default),
  }),
  method: 'POST',
  name: 'link-preview.suggestions',
  output: z.object({ variants: z.array(linkCopyVariantSchema).min(1).max(3) }),
  path: '/api/link-preview/suggestions',
  summary: 'Write link preview copy',
})

/** `GET /api/link-preview/image`: the image at `url` as a 1200 × 630 JPEG under 600 KB. */
export const optimizePreviewImageContract = defineContract({
  method: 'GET',
  name: 'link-preview.image',
  output: z.undefined(),
  path: '/api/link-preview/image',
  query: z.object({ url: z.url({ protocol: /^https?$/ }).max(2048) }),
  summary: 'Make a preview image that fits every platform',
})

/** A site's pages from its sitemap. */
export const linkPreviewSitemapSchema = z.object({
  /** The sitemap that was read. */
  sitemap: z.string(),
  /** Every page found; `urls` lists the first 500. */
  total: z.int().nonnegative(),
  urls: z.array(z.string()),
})

/** `GET /api/link-preview/sitemap`: the pages of a site, from its sitemap, to check in a batch. */
export const readSitemapContract = defineContract({
  method: 'GET',
  name: 'link-preview.sitemap',
  output: linkPreviewSitemapSchema,
  path: '/api/link-preview/sitemap',
  query: z.object({ url: z.url({ protocol: /^https?$/ }).max(2048) }),
  summary: 'List a site’s pages from its sitemap',
})

/** What one crawler received when it requested the page. */
export const crawlerFetchSchema = z.object({
  agent: linkPreviewAgentSchema,
  durationMs: z.int().nonnegative(),
  /** The final status after redirects. */
  status: z.int().optional(),
  error: z.string().optional(),
  finalUrl: z.string().optional(),
  title: z.string().optional(),
  ogTitle: z.string().optional(),
  ogImage: z.string().optional(),
  twitterCard: z.string().optional(),
  /** The bot protection that answered instead of the page, such as Cloudflare. */
  challenge: z.string().optional(),
})

/** One of {@link crawlerFetchSchema}. */
export type CrawlerFetch = z.infer<typeof crawlerFetchSchema>

/** `GET /api/link-preview/crawlers`: the page as every platform crawler receives it, side by side. */
export const crawlerMatrixContract = defineContract({
  method: 'GET',
  name: 'link-preview.crawlers',
  output: z.object({ results: z.array(crawlerFetchSchema) }),
  path: '/api/link-preview/crawlers',
  query: z.object({ url: z.url({ protocol: /^https?$/ }).max(2048) }),
  summary: 'Fetch a page as every crawler',
})

/** The preview tags as they stand after the page's JavaScript runs in a browser. */
export const linkPreviewRenderedSchema = linkPreviewSchema
  .pick({
    title: true,
    description: true,
    canonical: true,
    ogTitle: true,
    ogDescription: true,
    ogImage: true,
    ogUrl: true,
    ogType: true,
    ogSiteName: true,
    twitterCard: true,
    twitterTitle: true,
    twitterDescription: true,
    twitterImage: true,
  })
  .extend({ tagCount: z.int().nonnegative() })

/** One of {@link linkPreviewRenderedSchema}. */
export type LinkPreviewRendered = z.infer<typeof linkPreviewRenderedSchema>

/** `GET /api/link-preview/rendered`: the page's tags after JavaScript, from a headless browser. */
export const renderedHeadContract = defineContract({
  method: 'GET',
  name: 'link-preview.rendered',
  output: linkPreviewRenderedSchema,
  path: '/api/link-preview/rendered',
  query: z.object({ url: z.url({ protocol: /^https?$/ }).max(2048) }),
  summary: 'Read the tags after JavaScript runs',
})

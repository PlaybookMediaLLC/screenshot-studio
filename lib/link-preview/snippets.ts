import { isHttpUrl } from '@/lib/link-preview/urls'
import { z } from 'zod'
import type { LinkPreview } from '@/lib/api/contracts/link-preview'
import { issueSeveritySchema, type LinkPreviewIssue } from '@/lib/link-preview/audit'
import { CRAWLERS } from '@/lib/link-preview/crawlers'
import { articleMeta } from '@/lib/link-preview/extras'
import { escapeHtml } from '@/lib/link-preview/metadata'

/**
 * What to paste back into the page: edits applied on top of what was read,
 * the full recommended tag set as HTML or a Next.js `metadata` export, and a
 * Markdown report to share.
 */

/** Values a person tries out before changing the page; empty means keep the page's own. */
export const linkPreviewEditsSchema = z.object({
  title: z.string(),
  description: z.string(),
  image: z.string(),
  siteName: z.string(),
})

/** One of {@link linkPreviewEditsSchema}. */
export type LinkPreviewEdits = z.infer<typeof linkPreviewEditsSchema>

/** No edits. */
export const NO_EDITS: LinkPreviewEdits = { description: '', image: '', siteName: '', title: '' }

/** `preview` as it would read with `edits` applied to every tag that carries them. */
export function applyEdits(preview: LinkPreview, edits: LinkPreviewEdits): LinkPreview {
  const title = edits.title.trim()
  const description = edits.description.trim()
  const image = edits.image.trim()
  const siteName = edits.siteName.trim()
  return {
    ...preview,
    ...(title && { ogTitle: title, title, twitterTitle: title }),
    ...(description && {
      description,
      ogDescription: description,
      twitterDescription: description,
    }),
    ...(image && { ogImage: image, twitterImage: image }),
    ...(siteName && { ogSiteName: siteName }),
  }
}

/** The tag values to recommend: the page's own where it has them, placeholders where not. */
function recommended(preview: LinkPreview) {
  const found = preview.ogImage || preview.twitterImage
  const size = preview.images?.find((entry) => entry.url === found)
  // An image made in the browser has a blob: URL until it is uploaded somewhere public.
  const image = found?.startsWith('blob:')
    ? 'TODO: upload the generated image and use its https:// URL'
    : found && isHttpUrl(found) ? found : undefined
  return {
    title: preview.title || preview.ogTitle || 'TODO: a 30 to 60 character title',
    socialTitle: preview.ogTitle || preview.title || 'TODO: a title written for sharing',
    description:
      preview.ogDescription ||
      preview.description ||
      'TODO: 50 to 160 characters on what the page offers',
    url: preview.canonical || preview.ogUrl || preview.url,
    image: image || 'TODO: https:// URL of a 1200 × 630 PNG or JPEG',
    imageWidth: size?.width,
    imageHeight: size?.height,
    imageAlt: preview.ogImageAlt || preview.twitterImageAlt || 'TODO: describe the image',
    siteName: preview.ogSiteName || 'TODO: your brand name',
    type: preview.ogType || 'website',
    locale: preview.ogLocale,
    themeColor: preview.themeColor,
    twitterSite: preview.twitterSite || 'TODO: @yourhandle',
    twitterCreator: preview.twitterCreator,
  }
}

/** One recommended tag: a `<meta name>`, a `<meta property>`, or a `<link rel>`. */
type RecommendedTag = { attribute: 'name' | 'property' | 'rel'; key: string; value: string }

/** The recommended tags in order, as data, so each framework renders them its own way. */
function recommendedTags(preview: LinkPreview): RecommendedTag[] {
  const value = recommended(preview)
  const tag = (attribute: RecommendedTag['attribute'], key: string, content?: string | number) =>
    content === undefined ? [] : [{ attribute, key, value: String(content) }]
  return [
    ...tag('name', 'description', value.description),
    ...tag('rel', 'canonical', value.url),
    ...tag('name', 'theme-color', value.themeColor),
    ...tag('property', 'og:type', value.type),
    ...tag('property', 'og:url', value.url),
    ...tag('property', 'og:title', value.socialTitle),
    ...tag('property', 'og:description', value.description),
    ...tag('property', 'og:image', value.image),
    ...tag('property', 'og:image:width', value.imageWidth),
    ...tag('property', 'og:image:height', value.imageHeight),
    ...tag('property', 'og:image:alt', value.imageAlt),
    ...tag('property', 'og:site_name', value.siteName),
    ...tag('property', 'og:locale', value.locale),
    ...tag('name', 'twitter:card', 'summary_large_image'),
    ...tag('name', 'twitter:title', value.socialTitle),
    ...tag('name', 'twitter:description', value.description),
    ...tag('name', 'twitter:image', value.image),
    ...tag('name', 'twitter:image:alt', value.imageAlt),
    ...tag('name', 'twitter:site', value.twitterSite),
    ...tag('name', 'twitter:creator', value.twitterCreator),
  ]
}

/** The complete recommended `<head>` tags for the page. */
export function recommendedHtml(preview: LinkPreview): string {
  const lines = [`<title>${escapeHtml(recommended(preview).title)}</title>`]
  for (const { attribute, key, value } of recommendedTags(preview)) {
    if (key === 'og:type')
      lines.push('', '<!-- Open Graph: Facebook, LinkedIn, Slack, Discord, WhatsApp, iMessage -->')
    if (key === 'twitter:card') lines.push('', '<!-- X -->')
    lines.push(
      attribute === 'rel'
        ? `<link rel="${key}" href="${escapeHtml(value)}">`
        : `<meta ${attribute}="${key}" content="${escapeHtml(value)}">`
    )
  }
  return lines.join('\n')
}

/** The tags inside a SvelteKit `<svelte:head>`. */
export function recommendedSvelteKit(preview: LinkPreview): string {
  const html = recommendedHtml(preview)
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n')
  return `<svelte:head>\n${html}\n</svelte:head>\n`
}

/** The tags as a React Router (Remix) route `meta` export. */
export function recommendedReactRouter(preview: LinkPreview): string {
  const entries = recommendedTags(preview).map(({ attribute, key, value }) =>
    attribute === 'rel'
      ? { href: value, rel: key, tagName: 'link' }
      : { [attribute]: key, content: value }
  )
  const items = [{ title: recommended(preview).title }, ...entries]
    .map(
      (item) =>
        `  ${toSource(item, '  ').replace(/\n\s*/g, ' ').replace('{ ', '{ ').replace(', }', ' }')},`
    )
    .join('\n')
  return `import type { MetaFunction } from 'react-router'\n\nexport const meta: MetaFunction = () => [\n${items}\n]\n`
}

const camel = (key: string) =>
  key
    .replace(/^(og|twitter):/, '$1_')
    .replace(/[:_-]([a-z])/g, (_, letter: string) => letter.toUpperCase())

/** The tags as a Nuxt `useSeoMeta` call, with the canonical link in `useHead`. */
export function recommendedNuxt(preview: LinkPreview): string {
  const tags = recommendedTags(preview)
  const seo = Object.fromEntries([
    ['title', recommended(preview).title],
    ...tags
      .filter((tag) => tag.attribute !== 'rel' && tag.key !== 'theme-color')
      .map((tag) => [camel(tag.key), tag.value]),
  ])
  const canonical = tags.find((tag) => tag.attribute === 'rel')?.value ?? preview.url
  return [
    '<script setup lang="ts">',
    // `</script` inside a value would end the component's script block.
    `useSeoMeta(${toSource(seo).replace(/<\/script/gi, '<\\/script')})`,
    '',
    `useHead({ link: [{ rel: 'canonical', href: ${toSource(canonical)} }] })`,
    '</script>',
    '',
  ].join('\n')
}

/**
 * Structured data for the page: an Article for `og:type` article, otherwise
 * the Organization, WebSite, and WebPage graph that search engines use for
 * the site name, logo, and page.
 */
export function recommendedJsonLd(preview: LinkPreview): string {
  const value = recommended(preview)
  const origin = new URL(preview.url).origin
  const article = articleMeta(preview)
  const graph =
    preview.ogType?.toLowerCase() === 'article'
      ? [
          {
            '@type': 'Article',
            headline: value.socialTitle,
            description: value.description,
            image: [value.image],
            datePublished: article.publishedTime ?? 'TODO: 2026-10-16T09:00:00Z',
            ...(article.modifiedTime && { dateModified: article.modifiedTime }),
            author: (article.authors.length ? article.authors : ['TODO: author name']).map(
              (name) => ({ '@type': 'Person', name })
            ),
            mainEntityOfPage: value.url,
          },
        ]
      : [
          {
            '@type': 'Organization',
            '@id': `${origin}/#organization`,
            name: value.siteName,
            url: origin,
            ...(preview.favicon && { logo: preview.favicon }),
          },
          {
            '@type': 'WebSite',
            '@id': `${origin}/#website`,
            name: value.siteName,
            url: origin,
            publisher: { '@id': `${origin}/#organization` },
          },
          {
            '@type': 'WebPage',
            name: value.socialTitle,
            description: value.description,
            url: value.url,
            isPartOf: { '@id': `${origin}/#website` },
            primaryImageOfPage: value.image,
          },
        ]
  // `</` would end the script element early.
  const json = JSON.stringify(
    { '@context': 'https://schema.org', '@graph': graph },
    null,
    2
  ).replace(/<\//g, '<\\/')
  return `<script type="application/ld+json">\n${json}\n</script>\n`
}

/** A value as TypeScript source: unquoted keys, single-quoted strings, undefined dropped. */
function toSource(value: unknown, indent = ''): string {
  const inner = `${indent}  `
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  if (typeof value !== 'object' || value === null) return String(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => toSource(item, indent)).join(', ')}]`
  }
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined)
  const lines = entries.map(([key, entry]) => `${inner}${key}: ${toSource(entry, inner)},`)
  return `{\n${lines.join('\n')}\n${indent}}`
}

/** The same tags as a Next.js App Router `metadata` export. */
export function recommendedNextMetadata(preview: LinkPreview): string {
  const value = recommended(preview)
  const metadata = {
    title: value.title,
    description: value.description,
    alternates: { canonical: value.url },
    openGraph: {
      type: value.type,
      url: value.url,
      title: value.socialTitle,
      description: value.description,
      siteName: value.siteName,
      locale: value.locale,
      images: [
        {
          url: value.image,
          width: value.imageWidth,
          height: value.imageHeight,
          alt: value.imageAlt,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: value.socialTitle,
      description: value.description,
      images: [value.image],
      site: value.twitterSite,
      creator: value.twitterCreator,
    },
  }
  return `import type { Metadata } from 'next'\n\nexport const metadata: Metadata = ${toSource(metadata)}\n`
}

const { error, info, warning } = issueSeveritySchema.enum

/** How each severity reads in prose. */
export const SEVERITY_LABEL = { [error]: 'Error', [info]: 'Suggestion', [warning]: 'Warning' }

/** A Markdown report of the check: score, issues with fixes, the key tags, and crawler access. */
export function markdownReport(
  preview: LinkPreview,
  score: number,
  issues: LinkPreviewIssue[]
): string {
  const count = (severity: LinkPreviewIssue['severity']) =>
    issues.filter((issue) => issue.severity === severity).length
  const row = (label: string, value: string | undefined) =>
    `| ${label} | ${(value ?? 'Not set').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`
  const lines = [
    `# Link preview report: ${preview.url}`,
    '',
    `Score **${score}/100** · ${count(error)} errors · ${count(warning)} warnings · ${count(info)} suggestions`,
    '',
    '## Issues',
    '',
    ...(issues.length
      ? issues.map(
          (issue) => `- **${SEVERITY_LABEL[issue.severity]}: ${issue.title}.** ${issue.fix}`
        )
      : ['No issues found.']),
    '',
    '## Tags',
    '',
    '| Tag | Value |',
    '| --- | --- |',
    row('Title', preview.title),
    row('Description', preview.description),
    row('Canonical', preview.canonical),
    row('og:title', preview.ogTitle),
    row('og:description', preview.ogDescription),
    row('og:image', preview.ogImage),
    row('twitter:card', preview.twitterCard),
  ]
  if (preview.crawlers?.length) {
    lines.push('', '## Crawlers', '')
    for (const access of preview.crawlers) {
      const { name, token } = CRAWLERS[access.crawler]
      lines.push(
        `- ${name} (${token}): ${access.allowed ? 'allowed' : `blocked by \`${access.rule}\``}`
      )
    }
  }
  return `${lines.join('\n')}\n`
}

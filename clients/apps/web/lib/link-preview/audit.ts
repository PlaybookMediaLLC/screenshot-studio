import { characterCount } from '@/lib/link-preview/text'
import { isHttpUrl } from '@/lib/link-preview/urls'
import {
  issueCategorySchema,
  type IssueSeverity,
  issueSeveritySchema,
  type LinkPreview,
  linkPreviewCrawlerSchema,
  type LinkPreviewIssue,
  type LinkPreviewImage,
  linkPreviewTagAttributeSchema,
} from '@/lib/api/contracts/link-preview'
import { CRAWLERS } from '@/lib/link-preview/crawlers'
import {
  appLinks,
  articleMeta,
  HREFLANG,
  iconLinks,
  languageAlternates,
  videoMeta,
} from '@/lib/link-preview/extras'

/**
 * The audit: every way a page's link preview breaks or underperforms, each
 * with the fix. Pure, so it re-runs on edits in the browser.
 */

/** The issue vocabulary lives in the API contract; re-exported for the page. */
export {
  issueCategorySchema,
  type IssueSeverity,
  issueSeveritySchema,
  type LinkPreviewIssue,
  linkPreviewIssueSchema,
} from '@/lib/api/contracts/link-preview'

const { error, info, warning } = issueSeveritySchema.enum
const { content, images, indexing, social, technical } = issueCategorySchema.enum
const REL = linkPreviewTagAttributeSchema.enum.rel
const SEVERITY_ORDER = { [error]: 0, [warning]: 1, [info]: 2 }
const CARD_TYPES = ['summary', 'summary_large_image', 'app', 'player']
const UNIQUE_TAGS = [
  'description',
  'og:title',
  'og:description',
  'og:url',
  'og:type',
  'twitter:card',
  'twitter:title',
  'twitter:description',
]
const MB = 1024 * 1024
const CARD_RATIO = 1.91
const SLOW_MS = 3_000

const kb = (bytes: number) =>
  bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
const sameUrl = (a: string, b: string) =>
  a.replace(/#.*$/, '').replace(/\/$/, '') === b.replace(/#.*$/, '').replace(/\/$/, '')

type Add = (
  severity: IssueSeverity,
  category: LinkPreviewIssue['category'],
  id: string,
  title: string,
  fix: string
) => void

function contentIssues(preview: LinkPreview, add: Add) {
  const { description, title } = preview
  if (!title) {
    add(
      error,
      content,
      'title-missing',
      'The page has no <title>',
      'Add a 30 to 60 character title that names the page and the product.'
    )
  } else if (characterCount(title) > 60) {
    add(
      warning,
      content,
      'title-long',
      `The title is ${characterCount(title)} characters`,
      'Search results cut titles at about 60 characters. Put the important words first or shorten it.'
    )
  } else if (characterCount(title) < 30) {
    add(
      info,
      content,
      'title-short',
      `The title is only ${characterCount(title)} characters`,
      'A 30 to 60 character title gives search and social cards more to show.'
    )
  }
  if (!description) {
    add(
      warning,
      content,
      'description-missing',
      'No meta description',
      'Add <meta name="description"> with 50 to 160 characters; search results and many cards show it.'
    )
  } else if (characterCount(description) > 160) {
    add(
      warning,
      content,
      'description-long',
      `The description is ${characterCount(description)} characters`,
      'Search results cut descriptions at about 160 characters.'
    )
  } else if (characterCount(description) < 50) {
    add(
      info,
      content,
      'description-short',
      `The description is only ${characterCount(description)} characters`,
      'Aim for 50 to 160 characters so the snippet says what the page offers.'
    )
  }
}

function socialIssues(preview: LinkPreview, add: Add) {
  if (!preview.ogTitle)
    add(
      warning,
      social,
      'og-title-missing',
      'No og:title',
      'Platforms fall back to <title>, which often carries a site suffix. Add og:title written for sharing.'
    )
  if (!preview.ogDescription)
    add(
      warning,
      social,
      'og-description-missing',
      'No og:description',
      'Add og:description so cards show a summary instead of nothing or page text.'
    )
  if (!preview.ogImage)
    add(
      error,
      social,
      'og-image-missing',
      'No og:image',
      'Most platforms show a text-only card without it. Add a 1200 × 630 PNG or JPEG.'
    )
  if (!preview.ogUrl) {
    add(
      info,
      social,
      'og-url-missing',
      'No og:url',
      'Add og:url with the canonical URL so likes and shares count toward one address.'
    )
  } else if (preview.canonical && !sameUrl(preview.ogUrl, preview.canonical)) {
    add(
      warning,
      social,
      'og-url-canonical',
      'og:url and the canonical URL disagree',
      `og:url is ${preview.ogUrl} but canonical is ${preview.canonical}. Point both at the same URL.`
    )
  }
  if (!preview.ogLocale)
    add(info, social, 'og-locale-missing', 'No og:locale', 'Add og:locale, such as en_US, to declare the language of the shared card.')
  if (!preview.ogType)
    add(
      info,
      social,
      'og-type-missing',
      'No og:type',
      'Add og:type, usually "website" or "article".'
    )
  if (!preview.ogSiteName)
    add(
      info,
      social,
      'og-site-name-missing',
      'No og:site_name',
      'Add og:site_name so Facebook, Discord, and Slack show your brand above the title.'
    )
  const card = preview.twitterCard
  if (!card) {
    add(
      warning,
      social,
      'twitter-card-missing',
      'No twitter:card',
      'X shows a small summary card without it. Add <meta name="twitter:card" content="summary_large_image">.'
    )
  } else if (!CARD_TYPES.includes(card)) {
    add(
      error,
      social,
      'twitter-card-invalid',
      `twitter:card is "${card}"`,
      'X ignores unknown card types. Use summary_large_image or summary.'
    )
  } else if (card === 'summary' && preview.ogImage) {
    add(
      info,
      social,
      'twitter-card-small',
      'X shows a small square thumbnail',
      'Use twitter:card summary_large_image to show the image full width.'
    )
  }
  if (!preview.twitterSite)
    add(
      info,
      social,
      'twitter-site-missing',
      'No twitter:site',
      'Add your @handle in twitter:site so X credits your account on the card.'
    )
}

function imageIssues(
  preview: LinkPreview,
  label: string,
  url: string,
  image: LinkPreviewImage | undefined,
  add: Add
) {
  const id = label.replace(':', '-')
  if (preview.url.startsWith('https:') && url.startsWith('http:')) {
    add(
      warning,
      images,
      `${id}-insecure`,
      `${label} is served over http`,
      'Serve the image over https; some platforms skip insecure images.'
    )
  }
  if (!isHttpUrl(url)) {
    add(error, images, `${id}-invalid`, `${label} needs a public http(s) URL`, 'Use an absolute http:// or https:// image URL. Upload generated images before sharing.')
    return
  }
  if (!image) return
  if (image.error) {
    add(
      error,
      images,
      `${id}-unreachable`,
      `${label} could not be loaded`,
      `${image.error} Platforms will show the card without an image.`
    )
    return
  }
  const type = image.contentType ?? ''
  if (type && !type.startsWith('image/')) {
    add(
      error,
      images,
      `${id}-not-image`,
      `${label} returns ${type}, not an image`,
      'Point the tag at the image file itself, not a page.'
    )
  }
  if (image.format === 'svg' || type.includes('svg')) {
    add(
      error,
      images,
      `${id}-svg`,
      `${label} is an SVG`,
      'No major platform renders SVG previews. Export a PNG or JPEG.'
    )
  } else if (image.format && !['jpeg', 'png', 'webp', 'gif'].includes(image.format)) {
    add(
      warning,
      images,
      `${id}-format`,
      `${label} is ${image.format.toUpperCase()}`,
      'X accepts only JPEG, PNG, WebP, and GIF, and other platforms are stricter. Use JPEG or PNG.'
    )
  }
  const bytes = image.bytes ?? 0
  if (image.tooLarge) {
    add(
      error,
      images,
      `${id}-huge`,
      `${label} is over 8 MB`,
      'Facebook, X, and LinkedIn all reject it. Compress it under 1 MB.'
    )
  } else if (bytes > 5 * MB) {
    add(
      warning,
      images,
      `${id}-heavy`,
      `${label} is ${kb(bytes)}`,
      'X and LinkedIn reject images over 5 MB. Compress it under 1 MB.'
    )
  } else if (bytes > 600 * 1024) {
    add(
      info,
      images,
      `${id}-weight`,
      `${label} is ${kb(bytes)}`,
      'Large images unfurl slowly, and WhatsApp often drops big thumbnails. Aim for under 600 KB.'
    )
  }
  const { height, width } = image
  if (!width || !height) return
  if (width < 200 || height < 200) {
    add(
      error,
      images,
      `${id}-tiny`,
      `${label} is ${width} × ${height}`,
      'Facebook ignores images under 200 × 200. Use 1200 × 630.'
    )
  } else if (width < 600) {
    add(
      warning,
      images,
      `${id}-small`,
      `${label} is only ${width} px wide`,
      'Below 600 px, Facebook and LinkedIn show a small thumbnail instead of a large card. Use 1200 × 630.'
    )
  }
  const ratio = width / height
  if (Math.abs(ratio - CARD_RATIO) / CARD_RATIO > 0.1) {
    add(
      warning,
      images,
      `${id}-ratio`,
      `${label} is ${ratio.toFixed(2)}:1`,
      `Large cards crop to 1.91:1, so the edges of a ${width} × ${height} image get cut. Use 1200 × 630.`
    )
  }
}

function allImageIssues(preview: LinkPreview, add: Add) {
  const find = (url: string) => preview.images?.find((image) => image.url === url)
  const rawOgImage = preview.tags.find(
    (tag) => tag.attribute !== REL && tag.key.toLowerCase() === 'og:image'
  )?.value
  if (rawOgImage && !/^https?:\/\//i.test(rawOgImage)) {
    add(
      warning,
      images,
      'og-image-relative',
      'og:image is not an absolute URL',
      `"${rawOgImage}" works in a browser, but Facebook and LinkedIn need the full https:// URL.`
    )
  }
  if (preview.ogImage) {
    const image = find(preview.ogImage)
    imageIssues(preview, 'og:image', preview.ogImage, image, add)
    const width = Number(preview.ogImageWidth) || undefined
    const height = Number(preview.ogImageHeight) || undefined
    const wrongWidth = width !== undefined && width !== image?.width
    const wrongHeight = height !== undefined && height !== image?.height
    if (image?.width && (wrongWidth || wrongHeight)) {
      add(
        warning,
        images,
        'og-image-declared-size',
        'og:image:width or og:image:height is wrong',
        `They declare ${width ?? '?'} × ${height ?? '?'}, but the image is ${image.width} × ${image.height}. Platforms lay out the card from the declared size.`
      )
    }
    if (!preview.ogImageAlt)
      add(
        info,
        images,
        'og-image-alt',
        'No og:image:alt',
        'Describe the image for screen readers with og:image:alt.'
      )
  }
  if (preview.twitterImage && preview.twitterImage !== preview.ogImage) {
    imageIssues(preview, 'twitter:image', preview.twitterImage, find(preview.twitterImage), add)
  }
}

function indexingIssues(preview: LinkPreview, add: Add) {
  if (/noindex/i.test(preview.robots ?? '')) {
    add(
      warning,
      indexing,
      'meta-noindex',
      'The robots meta tag says noindex',
      'Search engines will drop the page. Remove noindex unless that is intended.'
    )
  }
  if (/noindex/i.test(preview.response?.xRobotsTag ?? '')) {
    add(
      warning,
      indexing,
      'header-noindex',
      'The X-Robots-Tag header says noindex',
      'The server tells search engines to drop the page. Remove the header unless that is intended.'
    )
  }
  if (!preview.canonical) {
    add(
      warning,
      indexing,
      'canonical-missing',
      'No canonical URL',
      'Add <link rel="canonical"> so search engines and platforms agree on one URL.'
    )
  } else {
    try {
      if (new URL(preview.canonical).host !== new URL(preview.url).host) {
        add(
          info,
          indexing,
          'canonical-host',
          'The canonical URL is on another host',
          `It points at ${preview.canonical}. Make sure that is the page you want shared and ranked.`
        )
      }
    } catch {
      add(
        warning,
        indexing,
        'canonical-invalid',
        'The canonical URL is not a valid URL',
        'Use an absolute https:// URL.'
      )
    }
  }
  for (const access of preview.crawlers ?? []) {
    if (access.allowed) continue
    const crawler = CRAWLERS[access.crawler]
    add(
      access.crawler === linkPreviewCrawlerSchema.enum.google ? warning : error,
      indexing,
      `robots-${access.crawler}`,
      `robots.txt blocks ${crawler.name} (${crawler.token})`,
      `"${access.rule}" stops ${crawler.name} from reading the page, so it cannot build a preview. Add "Allow: /" for ${crawler.token}.`
    )
  }
  if (!preview.jsonLd.length)
    add(
      info,
      indexing,
      'json-ld-missing',
      'No structured data',
      'Add JSON-LD (for example Organization, Product, or Article) for rich results in search.'
    )
  if (preview.response && !preview.sitemap)
    add(
      info,
      indexing,
      'sitemap-missing',
      'No sitemap found',
      'A sitemap helps search engines find every page.'
    )
}

function technicalIssues(preview: LinkPreview, add: Add) {
  const { response } = preview
  const status = response?.hops.at(-1)?.status
  if (status && status >= 400)
    add(error, technical, 'http-status', `The page returns HTTP ${status}`, 'Fix the response status so crawlers can reliably use the page and its preview.')
  if (preview.url.startsWith('http:')) {
    add(
      warning,
      technical,
      'not-https',
      'The page is served over http',
      'Serve it over https; browsers mark http pages as not secure and some platforms skip them.'
    )
  }
  const redirects = (response?.hops.length ?? 1) - 1
  if (redirects >= 3) {
    add(
      warning,
      technical,
      'redirects',
      `${redirects} redirects before the page`,
      'Some unfurlers stop following after a few hops. Link straight to the final URL.'
    )
  } else if (redirects > 0) {
    add(
      info,
      technical,
      'redirects',
      `${redirects} redirect${redirects > 1 ? 's' : ''} before the page`,
      'Each hop slows the preview. Share the final URL where you can.'
    )
  }
  if (response && response.durationMs > SLOW_MS) {
    add(
      warning,
      technical,
      'slow',
      `The page took ${(response.durationMs / 1000).toFixed(1)} s to respond`,
      'Unfurlers time out after a few seconds and fall back to a bare link. Cache or speed up the HTML response.'
    )
  }
  if (response?.truncated) {
    add(
      info,
      technical,
      'html-large',
      'The HTML is over 1.5 MB',
      'Crawlers read only the start of a page. Keep meta tags at the top of <head>.'
    )
  }
  if (!preview.viewport)
    add(
      warning,
      technical,
      'viewport-missing',
      'No viewport meta tag',
      'Add <meta name="viewport" content="width=device-width, initial-scale=1"> for mobile.'
    )
  if (!preview.language)
    add(
      info,
      technical,
      'lang-missing',
      'No lang attribute on <html>',
      'Add lang, such as <html lang="en">, for search and screen readers.'
    )
  if (!preview.favicon)
    add(
      warning,
      technical,
      'favicon-missing',
      'No favicon',
      'Slack, Discord, and Google show it beside the link. Add <link rel="icon">.'
    )
  if (!preview.themeColor)
    add(
      info,
      technical,
      'theme-color-missing',
      'No theme-color',
      'Discord colors the edge of the embed with it. Add <meta name="theme-color" content="#yourbrand">.'
    )
  for (const key of UNIQUE_TAGS) {
    const count = preview.tags.filter(
      (tag) => tag.attribute !== REL && tag.key.toLowerCase() === key
    ).length
    if (count > 1)
      add(
        warning,
        technical,
        `duplicate-${key}`,
        `${count} ${key} tags`,
        'Platforms read the first and ignore the rest, which may not be the one you meant. Keep one.'
      )
  }
  const canonicals = preview.tags.filter(
    (tag) => tag.attribute === REL && tag.key === 'canonical'
  ).length
  if (canonicals > 1)
    add(
      warning,
      technical,
      'duplicate-canonical',
      `${canonicals} canonical links`,
      'Search engines may ignore all of them. Keep one.'
    )
}

/** Copy that is technically present but reads badly: repeats, copies, and mixed signals. */
function copyQualityIssues(preview: LinkPreview, add: Add) {
  const { description, language, ogLocale, title } = preview
  if (title) {
    const parts = title
      .split(/\s+[|·•–—-]\s+/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
    const repeated = parts.find((part, index) => parts.indexOf(part) !== index)
    if (repeated) {
      add(
        warning,
        content,
        'title-repeated',
        `The title says "${repeated}" more than once`,
        'Name the brand once; repeats spend the 60 characters search results show.'
      )
    }
  }
  const same = (a?: string, b?: string) =>
    !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
  if (same(title, description) || same(preview.ogTitle, preview.ogDescription)) {
    add(
      warning,
      content,
      'description-is-title',
      'The description repeats the title',
      'Cards show both, one under the other. Use the description to say what the title cannot.'
    )
  }
  if (language && ogLocale) {
    const page = language.split('-')[0]!.toLowerCase()
    const locale = ogLocale.split(/[_-]/)[0]!.toLowerCase()
    if (page !== locale) {
      add(
        warning,
        content,
        'locale-mismatch',
        `<html lang="${language}"> but og:locale is ${ogLocale}`,
        'Make them agree, or platforms and search may label the page with the wrong language.'
      )
    }
  }
  if (preview.url.startsWith('https:') && preview.canonical?.startsWith('http:')) {
    add(
      warning,
      indexing,
      'canonical-insecure',
      'The canonical URL uses http',
      'Point it at the https address, or search engines may index the insecure version.'
    )
  }
}

function mediaIssues(preview: LinkPreview, add: Add) {
  const video = videoMeta(preview)
  if (preview.twitterCard === 'player') {
    if (!video.twitterPlayer) {
      add(
        error,
        social,
        'twitter-player-missing',
        'twitter:card is player, but there is no twitter:player',
        'Add twitter:player with the https URL of an embeddable player, or use summary_large_image.'
      )
    } else if (!video.twitterPlayer.startsWith('https://')) {
      add(
        error,
        social,
        'twitter-player-insecure',
        'twitter:player is not https',
        'X only embeds players served over https.'
      )
    }
    if (video.twitterPlayer && (!video.twitterPlayerWidth || !video.twitterPlayerHeight)) {
      add(
        warning,
        social,
        'twitter-player-size',
        'The player card has no size',
        'Add twitter:player:width and twitter:player:height; X sizes the player from them.'
      )
    }
  }
  if (video.ogVideo) {
    if (!video.ogVideoType) {
      add(
        warning,
        social,
        'og-video-type',
        'og:video has no og:video:type',
        'Add og:video:type, such as video/mp4, or text/html for an embed page.'
      )
    }
    if (
      preview.url.startsWith('https:') &&
      video.ogVideo.startsWith('http:') &&
      !video.ogVideoSecureUrl
    ) {
      add(
        warning,
        social,
        'og-video-insecure',
        'og:video is served over http',
        'Add og:video:secure_url with an https address; most platforms will not play insecure video.'
      )
    }
    if (!video.ogVideoWidth || !video.ogVideoHeight) {
      add(
        info,
        social,
        'og-video-size',
        'og:video has no size',
        'Add og:video:width and og:video:height so platforms reserve the right space.'
      )
    }
  }
  const article = articleMeta(preview)
  if (preview.ogType?.toLowerCase() === 'article') {
    if (!article.publishedTime) {
      add(
        warning,
        social,
        'article-published-missing',
        'The article has no published date',
        'Add article:published_time in ISO 8601, such as 2026-10-16T09:00:00Z. Facebook, LinkedIn, and search show it.'
      )
    }
    if (!article.authors.length) {
      add(
        info,
        social,
        'article-author-missing',
        'The article names no author',
        'Add article:author or <meta name="author"> so platforms can credit the writer.'
      )
    }
  }
  for (const [key, value] of [
    ['article:published_time', article.publishedTime],
    ['article:modified_time', article.modifiedTime],
  ] as const) {
    if (value && Number.isNaN(Date.parse(value))) {
      add(
        warning,
        social,
        `${key}-invalid`,
        `${key} is not a date`,
        `"${value}" cannot be read. Use ISO 8601, such as 2026-10-16T09:00:00Z.`
      )
    }
  }
}

function appAndLanguageIssues(preview: LinkPreview, add: Add) {
  const apps = appLinks(preview)
  if (apps.iosUrl && !apps.iosAppStoreId) {
    add(
      info,
      technical,
      'al-ios-store-id',
      'al:ios:url has no al:ios:app_store_id',
      'Add the App Store ID so people without the app are sent to install it.'
    )
  }
  if (apps.androidUrl && !apps.androidPackage) {
    add(
      warning,
      technical,
      'al-android-package',
      'al:android:url has no al:android:package',
      'Android needs the package name to open the app from a shared link.'
    )
  }
  if (apps.smartBanner && !/app-id=\d+/.test(apps.smartBanner)) {
    add(
      warning,
      technical,
      'smart-banner-id',
      'The Smart App Banner has no app-id',
      'Use <meta name="apple-itunes-app" content="app-id=123456789">.'
    )
  }
  const alternates = languageAlternates(preview)
  if (alternates.length) {
    const invalid = alternates.filter((alternate) => !HREFLANG.test(alternate.hreflang))
    if (invalid.length) {
      add(
        warning,
        indexing,
        'hreflang-invalid',
        `${invalid.length} hreflang value${invalid.length === 1 ? ' is' : 's are'} not a language code`,
        `Use codes like en, en-GB, or x-default. Found: ${invalid
          .slice(0, 3)
          .map((alternate) => alternate.hreflang)
          .join(', ')}.`
      )
    }
    if (!alternates.some((alternate) => alternate.hreflang.toLowerCase() === 'x-default')) {
      add(
        info,
        indexing,
        'hreflang-x-default',
        'No x-default alternate',
        'Add hreflang="x-default" for visitors whose language you do not list.'
      )
    }
    const self = preview.canonical ?? preview.url
    if (!alternates.some((alternate) => sameUrl(alternate.href, self))) {
      add(
        warning,
        indexing,
        'hreflang-self',
        'The language alternates leave out this page',
        'Each version should list itself too, or search engines may ignore the whole set.'
      )
    }
  }
  const { icons, manifest } = iconLinks(preview)
  if (!icons.some((icon) => icon.rel.startsWith('apple-touch-icon'))) {
    add(
      info,
      technical,
      'apple-touch-icon',
      'No apple-touch-icon',
      'iMessage and iOS home screens use it. Add a 180 × 180 PNG with <link rel="apple-touch-icon">.'
    )
  }
  if (!manifest) {
    add(
      info,
      technical,
      'manifest-missing',
      'No web app manifest',
      'Add <link rel="manifest"> so Android and Chrome know your name, icons, and colors.'
    )
  }
  if (preview.oembed?.error) {
    add(
      warning,
      technical,
      'oembed-broken',
      'The oEmbed endpoint failed',
      `${preview.oembed.error} Slack, Discord, and Notion fall back to plain tags.`
    )
  }
}

/** Where the canonical and og:url lead, and whether tracking tags survive the redirects. */
function linkTargetIssues(preview: LinkPreview, add: Add) {
  for (const target of preview.targets ?? []) {
    const id = target.kind.replace(':', '-')
    if (target.error) {
      add(
        error,
        indexing,
        `${id}-unreachable`,
        `The ${target.kind} URL could not be reached`,
        `${target.error} Platforms and search engines follow it, so point it at a live page.`
      )
    } else if (target.status && target.status >= 400) {
      add(
        error,
        indexing,
        `${id}-broken`,
        `The ${target.kind} URL returns HTTP ${target.status}`,
        `${target.url} is broken, so shares and search credit go to an error page. Point it at this page.`
      )
    } else if (target.finalUrl && !sameUrl(target.finalUrl, target.url)) {
      add(
        warning,
        indexing,
        `${id}-redirects`,
        `The ${target.kind} URL redirects`,
        `${target.url} redirects to ${target.finalUrl}. Use the final URL so crawlers do not have to follow the hop.`
      )
    }
  }
  const { tracking } = preview
  if (tracking && tracking.kept === false) {
    add(
      error,
      technical,
      'tracking-dropped',
      'Redirects drop UTM tags',
      `A link tagged with utm_source ended at ${tracking.finalUrl} without it, so campaign analytics lose every click. Keep the query string in the redirect, or share the final URL.`
    )
  }
}

/** Every issue with the page's preview, errors first. */
export function auditLinkPreview(preview: LinkPreview): LinkPreviewIssue[] {
  const issues: LinkPreviewIssue[] = []
  const add: Add = (severity, category, id, title, fix) =>
    issues.push({ category, fix, id, severity, title })
  contentIssues(preview, add)
  socialIssues(preview, add)
  allImageIssues(preview, add)
  indexingIssues(preview, add)
  technicalIssues(preview, add)
  copyQualityIssues(preview, add)
  mediaIssues(preview, add)
  appAndLanguageIssues(preview, add)
  linkTargetIssues(preview, add)
  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

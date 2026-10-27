import { type LinkPreview, linkPreviewTagAttributeSchema } from '@/lib/api/contracts/link-preview'

/**
 * The tags beyond the basic card: video and player cards, article details,
 * app links, alternate languages, and icons. Read from the page's tag list,
 * so they need no extra fetch. Pure, shared by the page and the audit.
 */

const REL = linkPreviewTagAttributeSchema.enum.rel

/** Every value of meta tag `key`, in document order. */
export function metaValues(preview: LinkPreview, key: string): string[] {
  return preview.tags
    .filter((tag) => tag.attribute !== REL && tag.key.toLowerCase() === key)
    .map((tag) => tag.value)
}

const first = (preview: LinkPreview, key: string) => metaValues(preview, key)[0]

/** Video for Open Graph and the player card X uses for playable media. */
export function videoMeta(preview: LinkPreview) {
  return {
    ogVideo: first(preview, 'og:video') ?? first(preview, 'og:video:url'),
    ogVideoSecureUrl: first(preview, 'og:video:secure_url'),
    ogVideoType: first(preview, 'og:video:type'),
    ogVideoWidth: first(preview, 'og:video:width'),
    ogVideoHeight: first(preview, 'og:video:height'),
    twitterPlayer: first(preview, 'twitter:player'),
    twitterPlayerWidth: first(preview, 'twitter:player:width'),
    twitterPlayerHeight: first(preview, 'twitter:player:height'),
    twitterPlayerStream: first(preview, 'twitter:player:stream'),
  }
}

/** Article details LinkedIn, Facebook, and search engines show for posts. */
export function articleMeta(preview: LinkPreview) {
  return {
    publishedTime: first(preview, 'article:published_time'),
    modifiedTime: first(preview, 'article:modified_time'),
    authors: [...metaValues(preview, 'article:author'), ...metaValues(preview, 'author')],
    section: first(preview, 'article:section'),
    tags: metaValues(preview, 'article:tag'),
  }
}

/** Deep links into native apps and the iOS Smart App Banner. */
export function appLinks(preview: LinkPreview) {
  return {
    iosUrl: first(preview, 'al:ios:url'),
    iosAppStoreId: first(preview, 'al:ios:app_store_id'),
    iosAppName: first(preview, 'al:ios:app_name'),
    androidUrl: first(preview, 'al:android:url'),
    androidPackage: first(preview, 'al:android:package'),
    androidAppName: first(preview, 'al:android:app_name'),
    smartBanner: first(preview, 'apple-itunes-app'),
    twitterAppIphone: first(preview, 'twitter:app:id:iphone'),
    twitterAppGooglePlay: first(preview, 'twitter:app:id:googleplay'),
  }
}

/** `<link rel="alternate" hreflang>` entries: the page in other languages. */
export function languageAlternates(preview: LinkPreview) {
  return preview.tags
    .filter((tag) => tag.attribute === REL && tag.key === 'alternate' && tag.hreflang)
    .map((tag) => ({ href: tag.value, hreflang: tag.hreflang! }))
}

const ICON_RELS = [
  'icon',
  'shortcut icon',
  'apple-touch-icon',
  'apple-touch-icon-precomposed',
  'mask-icon',
]

/** Every icon the page declares, and its web app manifest. */
export function iconLinks(preview: LinkPreview) {
  const icons = preview.tags
    .filter((tag) => tag.attribute === REL && ICON_RELS.includes(tag.key))
    .map((tag) => ({ href: tag.value, rel: tag.key, sizes: tag.sizes, type: tag.type }))
  const manifest = preview.tags.find((tag) => tag.attribute === REL && tag.key === 'manifest')
  return { icons, manifest: manifest?.value }
}

/** The page's oEmbed discovery link, when it has one. */
export function oembedLink(preview: LinkPreview): string | undefined {
  return preview.tags.find(
    (tag) =>
      tag.attribute === REL && tag.key === 'alternate' && tag.type === 'application/json+oembed'
  )?.value
}

/** BCP 47 language codes as hreflang allows them, plus `x-default`. */
export const HREFLANG = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i

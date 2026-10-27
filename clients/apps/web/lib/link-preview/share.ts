import { z } from 'zod'
import { characterCount, xCharacterCount } from '@/lib/link-preview/text'

/**
 * Sharing a checked link: tracked (UTM) links per channel, the share-intent
 * URL that opens each platform's composer, and post length the way each
 * platform counts it.
 */

/** Where a link gets shared. */
export const shareChannelSchema = z.enum([
  'x',
  'linkedin',
  'facebook',
  'threads',
  'bluesky',
  'mastodon',
  'reddit',
  'telegram',
  'whatsapp',
  'slack',
  'discord',
  'email',
])

/** One of {@link shareChannelSchema}. */
export type ShareChannel = z.infer<typeof shareChannelSchema>

const C = shareChannelSchema.enum

/** Each channel's label, `utm_source`, `utm_medium`, and post rules. */
export const CHANNELS: Record<
  ShareChannel,
  {
    name: string
    source: string
    medium: string
    /** Most characters a post may have, when the platform caps it. */
    limit?: number
    /** Every link counts as this many characters, as X and Mastodon do. */
    linkLength?: number
    /** Opens the platform's composer with the link and text filled in. */
    intent?: (url: string, text: string) => string
  }
> = {
  [C.x]: {
    name: 'X',
    source: 'x',
    medium: 'social',
    limit: 280,
    linkLength: 23,
    intent: (url, text) => `https://x.com/intent/post?${new URLSearchParams({ text, url })}`,
  },
  [C.linkedin]: {
    name: 'LinkedIn',
    source: 'linkedin',
    medium: 'social',
    limit: 3000,
    intent: (url) =>
      `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url })}`,
  },
  [C.facebook]: {
    name: 'Facebook',
    source: 'facebook',
    medium: 'social',
    limit: 63206,
    intent: (url) =>
      `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: url })}`,
  },
  [C.threads]: {
    name: 'Threads',
    source: 'threads',
    medium: 'social',
    limit: 500,
    intent: (url, text) =>
      `https://www.threads.net/intent/post?${new URLSearchParams({ text: joinText(text, url) })}`,
  },
  [C.bluesky]: {
    name: 'Bluesky',
    source: 'bluesky',
    medium: 'social',
    limit: 300,
    intent: (url, text) =>
      `https://bsky.app/intent/compose?${new URLSearchParams({ text: joinText(text, url) })}`,
  },
  [C.mastodon]: {
    name: 'Mastodon',
    source: 'mastodon',
    medium: 'social',
    limit: 500,
    linkLength: 23,
  },
  [C.reddit]: {
    name: 'Reddit',
    source: 'reddit',
    medium: 'social',
    limit: 300,
    intent: (url, text) =>
      `https://www.reddit.com/submit?${new URLSearchParams({ title: text, url })}`,
  },
  [C.telegram]: {
    name: 'Telegram',
    source: 'telegram',
    medium: 'social',
    limit: 4096,
    intent: (url, text) => `https://t.me/share/url?${new URLSearchParams({ text, url })}`,
  },
  [C.whatsapp]: {
    name: 'WhatsApp',
    source: 'whatsapp',
    medium: 'social',
    intent: (url, text) => `https://wa.me/?${new URLSearchParams({ text: joinText(text, url) })}`,
  },
  [C.slack]: { name: 'Slack', source: 'slack', medium: 'social', limit: 40000 },
  [C.discord]: { name: 'Discord', source: 'discord', medium: 'social', limit: 2000 },
  [C.email]: {
    name: 'Email',
    source: 'newsletter',
    medium: 'email',
    intent: (url, text) =>
      `mailto:?${new URLSearchParams({ body: joinText(text, url), subject: text.split('\n')[0] ?? '' })}`.replace(
        /\+/g,
        '%20'
      ),
  },
}

function joinText(text: string, url: string): string {
  return text.trim() ? `${text.trim()}\n\n${url}` : url
}

/** The campaign tags to add to every tracked link. */
export const utmCampaignSchema = z.object({
  campaign: z.string(),
  content: z.string(),
})

/** One of {@link utmCampaignSchema}. */
export type UtmCampaign = z.infer<typeof utmCampaignSchema>

/** `url` tagged for `channel`. Existing query parameters are kept; UTM ones are replaced. */
export function trackedLink(
  url: string,
  channel: ShareChannel,
  { campaign, content }: UtmCampaign
) {
  const tracked = new URL(url)
  const { medium, source } = CHANNELS[channel]
  tracked.searchParams.set('utm_source', source)
  tracked.searchParams.set('utm_medium', medium)
  if (campaign.trim()) tracked.searchParams.set('utm_campaign', campaign.trim())
  else tracked.searchParams.delete('utm_campaign')
  if (content.trim()) tracked.searchParams.set('utm_content', content.trim())
  else tracked.searchParams.delete('utm_content')
  return tracked.toString()
}

const URLS = /https?:\/\/\S+/g

/**
 * A post's length as `channel` counts it, including the shared link when the
 * platform puts links in the text. X uses weighted characters; others use graphemes.
 */
export function postLength(text: string, channel: ShareChannel, url: string): number {
  const { linkLength } = CHANNELS[channel]
  const withLink = linkLength && !text.includes(url) ? [text, url].filter(Boolean).join(' ') : text
  const counted = linkLength ? withLink.replace(URLS, 'x'.repeat(linkLength)) : withLink
  return channel === C.x ? xCharacterCount(counted) : characterCount(counted)
}

/**
 * Links in post text: full URLs, and bare domains on common TLDs as people
 * type them (so "Node.js" is not a link), never email addresses.
 */
const LINK =
  /\bhttps?:\/\/[^\s<>()"'`]+|(?<![@\w.-])(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|co|ai|so|sh|xyz|tech|me|gg|tv|fm|ly|to|us|uk|de|fr|ca|au|in|page|site|store|shop|blog|cloud|studio|design)\b(?:\/[^\s<>()"'`]*)?/gi

/** The distinct links in `text`, as https URLs, without trailing punctuation. */
export function linksInText(text: string): string[] {
  const links = (text.match(LINK) ?? []).flatMap((match) => {
    const trimmed = match.replace(/[.,;:!?)\]}'"]+$/, '')
    try {
      return [new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).toString()]
    } catch {
      return []
    }
  })
  return [...new Set(links)]
}

import {
  type LinkPreviewAgent,
  linkPreviewAgentSchema,
  type LinkPreviewCrawler,
} from '@/lib/api/contracts/link-preview'

/** What a platform's crawler is called: its display name, robots.txt token, and user agent. */
export const CRAWLERS: Record<
  LinkPreviewCrawler,
  { name: string; token: string; userAgent: string }
> = {
  facebook: {
    name: 'Facebook',
    token: 'facebookexternalhit',
    userAgent: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  },
  x: { name: 'X', token: 'Twitterbot', userAgent: 'Twitterbot/1.0' },
  linkedin: {
    name: 'LinkedIn',
    token: 'LinkedInBot',
    userAgent:
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  },
  slack: {
    name: 'Slack',
    token: 'Slackbot-LinkExpanding',
    userAgent: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  },
  discord: {
    name: 'Discord',
    token: 'Discordbot',
    userAgent: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  },
  telegram: { name: 'Telegram', token: 'TelegramBot', userAgent: 'TelegramBot (like TwitterBot)' },
  whatsapp: { name: 'WhatsApp', token: 'WhatsApp', userAgent: 'WhatsApp/2.23.20.0 A' },
  google: {
    name: 'Google',
    token: 'Googlebot',
    userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  },
}

/** The user agent the default fetch sends: a browser-like preview bot. */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; ScreenshotStudioLinkPreview/1.0; +https://shot.playbookmedia.io/link-preview)'

/** The user agent to send when fetching as `agent`. */
export function userAgentFor(agent: LinkPreviewAgent): string {
  return agent === linkPreviewAgentSchema.enum.default
    ? DEFAULT_USER_AGENT
    : CRAWLERS[agent].userAgent
}

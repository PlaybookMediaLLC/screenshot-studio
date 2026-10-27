import {
  type LinkPreviewAgent,
  linkPreviewAgentSchema,
  type LinkPreviewCrawler,
} from '@/lib/api/contracts/link-preview'
import { CANONICAL_HOST } from '@/lib/canonical-host'

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
export const DEFAULT_USER_AGENT = `Mozilla/5.0 (compatible; ScreenshotStudioLinkPreview/1.0; +https://${CANONICAL_HOST}/link-preview)`

/** The user agent to send when fetching as `agent`. */
export function userAgentFor(agent: LinkPreviewAgent): string {
  return agent === linkPreviewAgentSchema.enum.default
    ? DEFAULT_USER_AGENT
    : CRAWLERS[agent].userAgent
}

/** Signatures of bot protection that answers instead of the page. */
const CHALLENGES: Array<{
  name: string
  test: (status: number, headers: Headers, body: string) => boolean
}> = [
  {
    name: 'Cloudflare challenge',
    test: (_status, headers, body) =>
      headers.get('cf-mitigated') === 'challenge' ||
      /<title>(Just a moment\.\.\.|Attention Required! \| Cloudflare)<\/title>|challenge-platform|cf-chl-/i.test(
        body
      ),
  },
  {
    name: 'DataDome',
    test: (_status, headers, body) =>
      headers.has('x-datadome') || /captcha-delivery\.com|datadome/i.test(body),
  },
  {
    name: 'PerimeterX (HUMAN)',
    test: (_status, _headers, body) => /_pxCaptcha|px-captcha|perimeterx/i.test(body),
  },
  {
    name: 'Akamai Bot Manager',
    test: (status, headers, body) =>
      status === 403 && /akamai/i.test(headers.get('server') ?? '') && /Access Denied/i.test(body),
  },
  {
    name: 'Vercel Security Checkpoint',
    test: (_status, headers, body) =>
      headers.get('x-vercel-mitigated') === 'challenge' || /Vercel Security Checkpoint/i.test(body),
  },
  {
    name: 'A CAPTCHA',
    test: (status, _headers, body) => status >= 400 && /g-recaptcha|hcaptcha|turnstile/i.test(body),
  },
]

/** The bot protection that answered instead of the page, if any. */
export function detectChallenge(
  status: number,
  headers: Record<string, string | string[] | undefined>,
  body: string
): string | undefined {
  const normalized = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) normalized.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  return CHALLENGES.find((challenge) => challenge.test(status, normalized, body))?.name
}

import { withoutLocale } from '@/lib/settings/appearance'

/** Stable jobs; document URLs remain owned by their existing editors. */
export const PLATFORM_DESTINATIONS = [
  { href: '/home', label: 'Home', key: 'home' },
  { href: '/create', label: 'Create', key: 'create' },
  { href: '/campaigns', label: 'Campaigns', key: 'campaigns' },
  { href: '/write', label: 'Publish', key: 'publish' },
  { href: '/library', label: 'Library', key: 'library' },
  { href: '/workflows', label: 'Automate', key: 'automate' },
  { href: '/activity', label: 'Activity', key: 'activity' },
  { href: '/workspace', label: 'Settings', key: 'settings' },
] as const

export type PlatformArea = (typeof PLATFORM_DESTINATIONS)[number]['key']

/** One Publish vocabulary for every page in the area; `scope` keeps the publishing brand. */
export function publishLinks(scope = '', returnTo = `/write${scope}`) {
  return [
    { href: `/write${scope}`, label: 'Drafts' },
    { href: `/write/plan${scope}`, label: 'Calendar' },
    { href: `/write/analyze${scope}`, label: 'Analyze' },
    { href: `/write/deliveries${scope}`, label: 'Campaign deliveries' },
    { href: `/link-preview?returnTo=${encodeURIComponent(returnTo)}`, label: 'Link checks' },
  ]
}

/** Without drafts, Publish still owns Link checks, so it opens there instead of disappearing. */
export function withPublishAccess<T extends { href: string; key: string }>(
  item: T,
  draftsEnabled: boolean
): T {
  return item.key === 'publish' && !draftsEnabled ? { ...item, href: '/link-preview' } : item
}

const ROUTES: [PlatformArea, string[]][] = [
  ['home', ['/home']],
  [
    'create',
    [
      '/create',
      '/editor',
      '/canvas',
      '/creative-sets',
      '/store-screenshots',
      '/code',
      '/tweet',
      '/tools',
    ],
  ],
  ['campaigns', ['/campaigns', '/releases']],
  ['publish', ['/write', '/drafts', '/link-preview']],
  ['library', ['/library', '/projects', '/assets']],
  ['automate', ['/workflows']],
  ['activity', ['/activity']],
  ['settings', ['/workspace']],
]

/** Match complete path segments, including localized legacy URLs. */
export function platformArea(pathname: string): PlatformArea | undefined {
  const path = withoutLocale(pathname.split(/[?#]/)[0]!)
  if (path === '/') return 'create'
  return ROUTES.find(([, routes]) =>
    routes.some((route) => path === route || path.startsWith(`${route}/`))
  )?.[0]
}

/** Carry the current locale through shell destinations without double prefixing. */
export function platformHref(pathname: string, href: string): string {
  const path = withoutLocale(pathname)
  const prefix = path === pathname ? '' : `/${pathname.split('/')[1]}`
  return withoutLocale(href) !== href ? href : `${prefix}${href}`
}

/** Only internal paths can be used as return destinations. */
export function safeReturnPath(value: string | null | undefined, fallback = '/home'): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    return fallback
  return value
}

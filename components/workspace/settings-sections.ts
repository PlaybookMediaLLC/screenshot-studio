/**
 * Settings sections, each its own route under /workspace; shared by the
 * sidebar, the in-page settings navigation and the page (RFC 043). Sections
 * are grouped by who owns what they change: the person, the workspace, or a
 * publishing identity (a brand).
 */

import { z } from 'zod'

export type SettingId =
  | 'agents'
  | 'api'
  | 'appearance'
  | 'audit'
  | 'billing'
  | 'brand'
  | 'channels'
  | 'experimental'
  | 'general'
  | 'install'
  | 'integrations'
  | 'members'
  | 'new-team'
  | 'notifications'
  | 'product'
  | 'profile'
  | 'roles'
  | 'security'
  | 'sharing'
  | 'social-sets'
  | 'sso'
  | 'surfaces'

/** Who a section's settings belong to. */
export const settingGroupSchema = z.enum([
  'personal',
  'workspace',
  'brand',
  'publishing',
  'integrations',
  'advanced',
])

/** One of {@link settingGroupSchema}'s values. */
export type SettingGroup = z.infer<typeof settingGroupSchema>

export type SettingSection = {
  description: string
  group: SettingGroup
  id: SettingId
  /** URL segment under /workspace; General lives at /workspace itself. */
  slug: string
  title: string
}

/** Group headings, in display order. */
export const SETTING_GROUPS: { id: SettingGroup; title: string }[] = [
  { id: 'personal', title: 'My account' },
  { id: 'workspace', title: 'Workspace & team' },
  { id: 'brand', title: 'Brand & content' },
  { id: 'publishing', title: 'Publishing' },
  { id: 'integrations', title: 'Integrations' },
  { id: 'advanced', title: 'Advanced' },
]

export const SETTINGS_SECTIONS: SettingSection[] = [
  {
    description: 'Your profile, sign-in email, time zone, sessions, and account deletion.',
    group: 'personal',
    id: 'profile',
    slug: 'account',
    title: 'Account',
  },
  {
    id: 'notifications',
    group: 'personal',
    slug: 'notifications',
    title: 'Notifications',
    description: 'Activity preferences, delivery channels, and Slack notifications.',
  },
  {
    description: 'Theme, navigation, calendar, editor direction, and scrollbars.',
    group: 'personal',
    id: 'appearance',
    slug: 'appearance',
    title: 'Appearance',
  },
  {
    description: 'Two-factor authentication and session controls.',
    group: 'personal',
    id: 'security',
    slug: 'security',
    title: 'Security',
  },
  {
    description: 'Use Shots as an app on your computer or phone.',
    group: 'personal',
    id: 'install',
    slug: 'install',
    title: 'Install',
  },
  {
    description: 'Workspace name, slug, logo URL, time zone (timezone), release preferences, and defaults.',
    group: 'workspace',
    id: 'general',
    slug: '',
    title: 'General',
  },
  {
    description: 'Your plan, billing status, and AI credits.',
    group: 'workspace',
    id: 'billing',
    slug: 'billing',
    title: 'Billing',
  },
  {
    description: 'Invite, manage, and remove workspace members.',
    group: 'workspace',
    id: 'members',
    slug: 'members',
    title: 'Members',
  },
  {
    description: 'Workspace roles and least-privilege permissions.',
    group: 'workspace',
    id: 'roles',
    slug: 'roles',
    title: 'Roles',
  },
  {
    description: 'Single sign-on and SCIM provisioning controls.',
    group: 'advanced',
    id: 'sso',
    slug: 'sso',
    title: 'SSO',
  },
  {
    description: 'Searchable events, retention, and SIEM log drains.',
    group: 'advanced',
    id: 'audit',
    slug: 'audit-log',
    title: 'Audit log',
  },
  {
    description: 'Brand voice for AI copy, plus colors and typography for visuals.',
    group: 'brand',
    id: 'brand',
    slug: 'brand-kit',
    title: 'Brand kit',
  },
  {
    description: 'What your product is, who it is for, and what campaigns can claim.',
    group: 'brand',
    id: 'product',
    slug: 'product',
    title: 'Product',
  },
  {
    description: 'The product pages campaigns screenshot, and how fresh each capture is.',
    group: 'brand',
    id: 'surfaces',
    slug: 'product-pages',
    title: 'Product pages',
  },
  {
    description: 'Every agent and app Shots connects to, what each needs, and how to set it up.',
    group: 'integrations',
    id: 'integrations',
    slug: 'integrations',
    title: 'Integrations',
  },
  {
    description: 'Connect Claude, ChatGPT, Cursor, and other AI agents to this workspace over MCP.',
    group: 'integrations',
    id: 'agents',
    slug: 'ai-agents',
    title: 'AI agents',
  },
  {
    description: 'Every design published at a link: copy, restrict, or revoke.',
    group: 'publishing',
    id: 'sharing',
    slug: 'shared-links',
    title: 'Shared links',
  },
  {
    description: 'API keys, outbound webhooks, development mode, and debug logs.',
    group: 'advanced',
    id: 'api',
    slug: 'developers',
    title: 'Developer API',
  },
  {
    description: 'Try features before they ship to everyone.',
    group: 'advanced',
    id: 'experimental',
    slug: 'experimental',
    title: 'Experimental',
  },
  {
    description: 'Start a separate workspace for a team, project, or client.',
    group: 'workspace',
    id: 'new-team',
    slug: 'new-team',
    title: 'Create workspace',
  },
  {
    description:
      'The people and brands you post as: their accounts, schedules, defaults, and voice.',
    group: 'publishing',
    id: 'social-sets',
    slug: 'social-sets',
    title: 'Brands',
  },
  {
    description: 'Every connected account in the workspace and the set it belongs to.',
    group: 'publishing',
    id: 'channels',
    slug: 'channels',
    title: 'Channels',
  },
]

/** The pages of one brand's settings, in display order. */
export const SOCIAL_SET_PAGES = [
  { slug: 'general', title: 'General' },
  { slug: 'scheduling', title: 'Scheduling' },
  { slug: 'new-draft', title: 'New draft' },
  { slug: 'public-profile', title: 'Public profile' },
  { slug: 'writing-assistant', title: 'Writing Assistant' },
] as const

/** One of {@link SOCIAL_SET_PAGES}' slugs. */
export type SocialSetPage = (typeof SOCIAL_SET_PAGES)[number]['slug']

export function settingsHref(section: SettingSection): string {
  return section.slug ? `/workspace/${section.slug}` : '/workspace'
}

/** The address of one brand's settings page. */
export function socialSetHref(id: string, page: SocialSetPage = 'general'): string {
  return `/workspace/social-sets/${encodeURIComponent(id)}${page === 'general' ? '' : `/${page}`}`
}

export function findSettingsSection(slug: string | undefined): SettingSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.slug === (slug ?? ''))
}

/** A brand settings page by its slug; General when omitted. */
export function findSocialSetPage(slug: string | undefined): SocialSetPage | undefined {
  return SOCIAL_SET_PAGES.find((page) => page.slug === (slug ?? 'general'))?.slug
}

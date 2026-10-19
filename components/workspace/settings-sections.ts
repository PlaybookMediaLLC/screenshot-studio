/** Workspace settings sections, each its own route; shared by the sidebar and the page. */

export type SettingId =
  | 'agents'
  | 'api'
  | 'audit'
  | 'billing'
  | 'brand'
  | 'channels'
  | 'general'
  | 'integrations'
  | 'members'
  | 'product'
  | 'profile'
  | 'release-automation'
  | 'roles'
  | 'security'
  | 'sharing'
  | 'sso'
  | 'surfaces'

export type SettingSection = {
  description: string
  id: SettingId
  /** URL segment under /workspace; General lives at /workspace itself. */
  slug: string
  title: string
}

export const SETTINGS_SECTIONS: SettingSection[] = [
  {
    description: 'Workspace name, release preferences, and defaults.',
    id: 'general',
    slug: '',
    title: 'General',
  },
  {
    description: 'Connect repositories and turn release events into drafts for review.',
    id: 'release-automation',
    slug: 'release-automation',
    title: 'Release automation',
  },
  {
    description: 'Your profile, email address, and account security.',
    id: 'profile',
    slug: 'account',
    title: 'Account',
  },
  {
    description: 'Invite, manage, and remove workspace members.',
    id: 'members',
    slug: 'members',
    title: 'Members',
  },
  {
    description: 'Workspace roles and least-privilege permissions.',
    id: 'roles',
    slug: 'roles',
    title: 'Roles',
  },
  {
    description: 'Your plan, billing status, and AI credits.',
    id: 'billing',
    slug: 'billing',
    title: 'Billing',
  },
  {
    description: 'Two-factor authentication and session controls.',
    id: 'security',
    slug: 'security',
    title: 'Security',
  },
  {
    description: 'Single sign-on and SCIM provisioning controls.',
    id: 'sso',
    slug: 'sso',
    title: 'SSO',
  },
  {
    description: 'Searchable events, retention, and SIEM log drains.',
    id: 'audit',
    slug: 'audit-log',
    title: 'Audit log',
  },
  {
    description: 'Brand voice for AI copy, plus colors and typography for visuals.',
    id: 'brand',
    slug: 'brand-kit',
    title: 'Brand kit',
  },
  {
    description: 'Slack, Notion, and Figma connections for delivering published designs.',
    id: 'integrations',
    slug: 'integrations',
    title: 'Integrations',
  },
  {
    description: 'Connect Claude, ChatGPT, Cursor, and other AI agents to this workspace over MCP.',
    id: 'agents',
    slug: 'ai-agents',
    title: 'AI agents',
  },
  {
    description: 'Every design published at a link: copy, restrict, or revoke.',
    id: 'sharing',
    slug: 'shared-links',
    title: 'Shared links',
  },
  {
    description: 'What your product is, who it is for, and what campaigns can claim.',
    id: 'product',
    slug: 'product',
    title: 'Product',
  },
  {
    description: 'The product pages campaigns screenshot, and how fresh each capture is.',
    id: 'surfaces',
    slug: 'product-pages',
    title: 'Product pages',
  },
  {
    description: 'Social accounts that approved posts publish to.',
    id: 'channels',
    slug: 'channels',
    title: 'Channels',
  },
  {
    description: 'Scoped keys for release webhooks and content automation.',
    id: 'api',
    slug: 'developers',
    title: 'Developer API',
  },
]

export function settingsHref(section: SettingSection): string {
  return section.slug ? `/workspace/${section.slug}` : '/workspace'
}

export function findSettingsSection(slug: string | undefined): SettingSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.slug === (slug ?? ''))
}

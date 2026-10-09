/** Workspace settings sections, each its own route; shared by the sidebar and the page. */

export type SettingId =
  'api' | 'audit' | 'brand' | 'general' | 'members' | 'profile' | 'roles' | 'security' | 'sso'

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

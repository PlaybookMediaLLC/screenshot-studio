'use client'

import {
  AccountSetting01Icon,
  Audit02Icon,
  Building02Icon,
  Key01Icon,
  PaintBoardIcon,
  Search01Icon,
  SecurityCheckIcon,
  UserAccountIcon,
  UserGroupIcon,
  UserSettings01Icon,
} from 'hugeicons-react'
import Link from 'next/link'
import { useState } from 'react'
import { AccountMenu } from '@/components/auth/AccountMenu'
import { ProfileForm } from '@/components/auth/ProfileForm'

type SettingsIcon = typeof Building02Icon
type SettingId = 'profile' | 'general' | 'members' | 'roles' | 'security' | 'sso' | 'audit' | 'brand' | 'api'
type ViewId = 'overview' | SettingId

type SettingItem = {
  description: string
  icon: SettingsIcon
  id: SettingId
  title: string
}

type WorkspaceSettingsProps = {
  email: string
  name: string
  organizationName: string
}

const settings: SettingItem[] = [
  {
    description: 'Your profile, email address, and account security.',
    icon: UserAccountIcon,
    id: 'profile',
    title: 'Account',
  },
  {
    description: 'Workspace name, release preferences, and defaults.',
    icon: Building02Icon,
    id: 'general',
    title: 'General',
  },
  {
    description: 'Invite, manage, and remove workspace members.',
    icon: UserGroupIcon,
    id: 'members',
    title: 'Members',
  },
  {
    description: 'Workspace roles and least-privilege permissions.',
    icon: UserSettings01Icon,
    id: 'roles',
    title: 'Roles',
  },
  {
    description: 'Two-factor authentication and session controls.',
    icon: SecurityCheckIcon,
    id: 'security',
    title: 'Security',
  },
  {
    description: 'Single sign-on and SCIM provisioning controls.',
    icon: AccountSetting01Icon,
    id: 'sso',
    title: 'SSO',
  },
  {
    description: 'Searchable events, retention, and SIEM log drains.',
    icon: Audit02Icon,
    id: 'audit',
    title: 'Audit log',
  },
  {
    description: 'Colors, typography, and reusable content templates.',
    icon: PaintBoardIcon,
    id: 'brand',
    title: 'Brand kit',
  },
  {
    description: 'Scoped keys for release webhooks and content automation.',
    icon: Key01Icon,
    id: 'api',
    title: 'Developer API',
  },
]

const navigation = settings.slice(0, 8)

function SettingsCard({ item, onOpen }: { item: SettingItem; onOpen: (id: SettingId) => void }) {
  const Icon = item.icon

  return (
    <button
      className="group flex min-h-36 items-start gap-4 rounded-lg border border-border bg-background p-5 text-left transition-colors hover:border-foreground/25 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onOpen(item.id)}
      type="button"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
        <Icon size={20} />
      </span>
      <span>
        <span className="block text-base font-semibold text-foreground">{item.title}</span>
        <span className="mt-1 block text-sm leading-6 text-muted-foreground">{item.description}</span>
      </span>
    </button>
  )
}

function SettingDetail({
  email,
  item,
  name,
  onBack,
}: {
  email: string
  item: SettingItem
  name: string
  onBack: () => void
}) {
  const Icon = item.icon

  return (
    <section className="max-w-2xl">
      <button className="text-sm font-medium text-muted-foreground hover:text-foreground" onClick={onBack} type="button">
        All settings
      </button>
      <div className="mt-6 rounded-lg border border-border bg-background p-6 sm:p-8">
        <span className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon size={22} />
        </span>
        <h2 className="mt-5 text-xl font-semibold">{item.title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
        {item.id === 'profile' ? (
          <div className="mt-8 border-t pt-6">
            <ProfileForm email={email} name={name} />
          </div>
        ) : (
          <p className="mt-8 rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
            This workspace control is ready for its connected workflow.
          </p>
        )}
      </div>
    </section>
  )
}

export function WorkspaceSettings({ email, name, organizationName }: WorkspaceSettingsProps) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewId>('overview')
  const search = query.trim().toLowerCase()
  const visibleSettings = settings.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(search))
  const selected = view === 'overview' ? null : settings.find((item) => item.id === view)

  return (
    <main className="min-h-screen bg-background text-foreground [--background:#fff] [--foreground:#1d2129] [--card:#fff] [--muted:#f4f5f7] [--muted-foreground:#697386] [--border:#e5e7eb] [--ring:#7c8699] [--primary:#1d2129] [--primary-foreground:#fff]">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-5 sm:px-8">
          <Link className="flex items-center gap-2 text-sm font-semibold" href="/">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
              <Building02Icon size={16} />
            </span>
            Screenshot Studio
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-muted-foreground sm:inline">{organizationName}</span>
            <Link className="text-sm font-medium text-muted-foreground hover:text-foreground" href="/">
              Open editor
            </Link>
            <AccountMenu />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] px-5 py-10 sm:px-8 lg:py-14">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 text-base text-muted-foreground">Manage your workspace, access, and brand preferences.</p>
          <div className="mt-9 flex items-center gap-3 text-sm">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Building02Icon size={18} />
            </span>
            <span className="text-muted-foreground">Settings for</span>
            <span className="font-semibold">{organizationName}</span>
          </div>
        </header>

        <div className="mt-12 grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <aside className="lg:border-r lg:pr-6">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Workspace</p>
            <nav className="grid gap-1" aria-label="Workspace settings">
              <button
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors ${view === 'overview' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                onClick={() => setView('overview')}
                type="button"
              >
                <UserAccountIcon size={18} />
                Account
              </button>
              {navigation.slice(1).map((item) => {
                const Icon = item.icon
                const isActive = view === item.id

                return (
                  <button
                    key={item.id}
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors ${isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                    onClick={() => setView(item.id)}
                    type="button"
                  >
                    <Icon size={18} />
                    {item.title}
                  </button>
                )
              })}
            </nav>
          </aside>

          <div>
            {selected ? (
              <SettingDetail email={email} item={selected} name={name} onBack={() => setView('overview')} />
            ) : (
              <>
                <label className="relative block max-w-xl" htmlFor="settings-search">
                  <Search01Icon className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={19} />
                  <input
                    className="h-11 w-full rounded-md border border-border bg-background pl-11 pr-4 text-sm shadow-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
                    id="settings-search"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search settings..."
                    type="search"
                    value={query}
                  />
                </label>
                <section className="mt-9">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Workspace</h2>
                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    {visibleSettings.map((item) => (
                      <SettingsCard item={item} key={item.id} onOpen={setView} />
                    ))}
                  </div>
                  {visibleSettings.length === 0 ? (
                    <p className="mt-6 text-sm text-muted-foreground">No settings match “{query}”.</p>
                  ) : null}
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

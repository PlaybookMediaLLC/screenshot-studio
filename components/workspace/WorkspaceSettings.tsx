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
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppHeader } from './AppHeader'
import { WorkspaceSettingDetail } from './WorkspaceSettingDetail'

type SettingsIcon = typeof Building02Icon
export type SettingId =
  'profile' | 'general' | 'members' | 'roles' | 'security' | 'sso' | 'audit' | 'brand' | 'api'
type ViewId = 'overview' | SettingId

export type SettingItem = {
  description: string
  icon: SettingsIcon
  id: SettingId
  title: string
}

export type WorkspaceSettingsProps = {
  email: string
  name: string
  organization: { id: string; name: string; slug: string }
  role: string
  twoFactorEnabled: boolean
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
    <Button
      className="group h-auto w-full justify-start gap-4 whitespace-normal rounded-lg border border-foreground/10 bg-card p-4 text-left shadow-none transition-colors hover:border-foreground/25 hover:bg-muted/35"
      onClick={() => onOpen(item.id)}
      type="button"
      variant="outline"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
        <Icon size={20} />
      </span>
      <span>
        <span className="block text-base font-semibold text-foreground">{item.title}</span>
        <span className="mt-0.5 block text-sm leading-5 text-muted-foreground">
          {item.description}
        </span>
      </span>
    </Button>
  )
}

export function WorkspaceSettings({
  email,
  name,
  organization,
  role,
  twoFactorEnabled,
}: WorkspaceSettingsProps) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewId>('overview')
  const search = query.trim().toLowerCase()
  const visibleSettings = settings.filter((item) =>
    `${item.title} ${item.description}`.toLowerCase().includes(search)
  )
  const selected = view === 'overview' ? null : settings.find((item) => item.id === view)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader current="/workspace" orgName={organization.name} />

      <div className="w-full px-5 py-8 sm:px-8 lg:py-10">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 text-base text-muted-foreground">
            Manage your workspace, access, and brand preferences.
          </p>
          <div className="mt-7 flex items-center gap-3 text-sm">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Building02Icon size={18} />
            </span>
            <span className="text-muted-foreground">Settings for</span>
            <span className="font-semibold">{organization.name}</span>
          </div>
        </header>

        <div className="mt-9 grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <aside className="lg:border-r lg:pr-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Workspace
            </p>
            <nav className="grid gap-1" aria-label="Workspace settings">
              <Button
                className={`h-auto w-full justify-start gap-3 px-3 py-2.5 text-left ${view === 'profile' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                onClick={() => setView('profile')}
                type="button"
                variant="ghost"
              >
                <UserAccountIcon size={18} />
                Account
              </Button>
              {navigation.slice(1).map((item) => {
                const Icon = item.icon
                const isActive = view === item.id

                return (
                  <Button
                    key={item.id}
                    className={`h-auto w-full justify-start gap-3 px-3 py-2.5 text-left ${isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                    onClick={() => setView(item.id)}
                    type="button"
                    variant="ghost"
                  >
                    <Icon size={18} />
                    {item.title}
                  </Button>
                )
              })}
            </nav>
          </aside>

          <div>
            {selected ? (
              <WorkspaceSettingDetail
                email={email}
                item={selected}
                name={name}
                onBack={() => setView('overview')}
                organization={organization}
                role={role}
                twoFactorEnabled={twoFactorEnabled}
              />
            ) : (
              <>
                <Label className="relative block max-w-xl" htmlFor="settings-search">
                  <span className="sr-only">Search settings</span>
                  <Search01Icon
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                    size={19}
                  />
                  <Input
                    className="h-11 bg-card pl-11"
                    id="settings-search"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search settings..."
                    type="search"
                    value={query}
                  />
                </Label>
                <section className="mt-8">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Workspace
                  </h2>
                  <div className="mt-4 grid gap-3 xl:grid-cols-2">
                    {visibleSettings.map((item) => (
                      <SettingsCard item={item} key={item.id} onOpen={setView} />
                    ))}
                  </div>
                  {visibleSettings.length === 0 ? (
                    <p className="mt-6 text-sm text-muted-foreground">
                      No settings match “{query}”.
                    </p>
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

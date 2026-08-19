import Image from 'next/image'
import Link from 'next/link'
import { AccountMenu } from '@/components/auth/AccountMenu'
import { cn } from '@/lib/utils'

/**
 * The shared header for signed-in platform pages.
 *
 * Each surface previously built its own header, so navigation depended
 * on which page the user landed on. This header gives every page the
 * same routes: the editor, the asset library, and workspace settings.
 */

const NAV_LINKS = [
  { href: '/', label: 'Editor' },
  { href: '/assets', label: 'Assets' },
  { href: '/workspace', label: 'Settings' },
] as const

export type AppNavHref = (typeof NAV_LINKS)[number]['href']

export interface AppHeaderProps {
  /** The nav link that matches the current page. */
  current?: AppNavHref
  /** The active organization name, shown before the account menu. */
  orgName?: string
}

export function AppHeader({ current, orgName }: AppHeaderProps) {
  return (
    <header className="h-16 border-b border-foreground/10 bg-background">
      <div className="flex h-full items-center justify-between gap-3 px-4">
        <div className="flex h-8 min-w-0 items-center">
          <Link
            className="flex h-8 shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80"
            href="/"
          >
            <Image
              alt="Screenshot Studio"
              className="h-8 w-8"
              height={32}
              priority
              src="/logo-mark.png"
              width={32}
            />
            <span className="hidden text-sm font-semibold leading-none tracking-tight text-foreground sm:inline">
              Screenshot Studio
            </span>
          </Link>
          <span aria-hidden className="mx-2.5 h-4 w-px shrink-0 bg-foreground/10" />
          <nav aria-label="Workspace" className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                aria-current={link.href === current ? 'page' : undefined}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                  link.href === current
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {orgName ? (
            <span className="hidden text-sm text-muted-foreground sm:inline">{orgName}</span>
          ) : null}
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}

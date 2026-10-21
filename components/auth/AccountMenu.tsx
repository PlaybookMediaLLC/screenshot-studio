'use client'

import Link from 'next/link'
import { UserAvatar } from './UserAvatar'
import { type ReactNode, useEffect, useState } from 'react'
import { authClient, useHydratedSession } from '@/lib/auth/client'
import { resetUser } from '@/lib/analytics'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTRPCClient } from '@/lib/trpc/react'
import { Button } from '@/components/ui/button'

type Workspace = { id: string; isScheduledForDeletion: boolean; name: string; slug: string }

export function AccountMenu({
  align = 'end',
  children,
  side = 'bottom',
  triggerClassName,
  workspaceName,
}: {
  align?: 'center' | 'end' | 'start'
  /** Custom trigger content, e.g. the sidebar's workspace row; defaults to an avatar. */
  children?: ReactNode
  /** Where the menu opens; the sidebar opens it upward or to the right. */
  side?: 'bottom' | 'right' | 'top'
  triggerClassName?: string
  /** The active workspace, shown in the menu so it is named even when the trigger is a badge. */
  workspaceName?: string
} = {}) {
  const trpcClient = useTRPCClient()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const { data: session, isPending } = useHydratedSession()

  useEffect(() => {
    if (!session) {
      setWorkspaces([])
      return
    }

    let active = true
    void trpcClient.workspace.listMine
      .query()
      .then((result) => {
        if (active) {
          setWorkspaces(result.workspaces)
        }
      })
      .catch(() => active && setWorkspaces([]))

    return () => {
      active = false
    }
  }, [session, trpcClient])

  async function handleSignOut() {
    setIsSigningOut(true)
    await authClient.signOut()
    // Forget the analytics device ID so the next person on this browser starts fresh.
    resetUser()
    window.location.assign('/sign-in')
  }

  async function handleWorkspaceSwitch(organizationId: string): Promise<void> {
    if (organizationId === session?.session.activeOrganizationId) {
      return
    }

    setWorkspaceError(null)
    setIsSwitchingWorkspace(true)
    try {
      await trpcClient.workspace.setActive.mutate({ organizationId })
      window.location.assign('/')
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Could not switch workspace.')
      setIsSwitchingWorkspace(false)
    }
  }

  if (isPending) return <div aria-hidden className={triggerClassName ?? 'h-8 w-8'} />

  if (!session) {
    return (
      <Link
        href="/sign-in"
        className="rounded-md px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        Sign in
      </Link>
    )
  }

  const name = session.user.name || session.user.email
  const hasUnavailableActiveWorkspace = Boolean(
    session.session.activeOrganizationId &&
    !workspaces.some((workspace) => workspace.id === session.session.activeOrganizationId)
  )
  const canSwitchWorkspace = workspaces.length > 1 || hasUnavailableActiveWorkspace

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="custom" size={null}
          aria-label="Open account menu"
          className={
            triggerClassName ??
            'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-opacity hover:opacity-80'
          }
          type="button"
        >
          {children ?? <UserAvatar name={name} image={session.user.image} />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72 max-w-[calc(100vw-2rem)] p-2" side={side}>
        <div className="min-w-0 border-b px-2 py-2.5">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="break-all text-xs text-muted-foreground">{session.user.email}</p>
          {workspaceName ? (
            <p className="mt-1.5 truncate text-xs text-muted-foreground">
              Workspace: <span className="text-foreground">{workspaceName}</span>
            </p>
          ) : null}
        </div>
        {canSwitchWorkspace ? (
          <div className="grid gap-1 border-b py-2">
            <p className="px-2 text-xs font-medium text-muted-foreground">Workspaces</p>
            {workspaces.map((workspace) => {
              const isActive = workspace.id === session.session.activeOrganizationId
              return (
                <Button variant="custom" size={null}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={`Switch to ${workspace.name}`}
                  className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isActive || isSwitchingWorkspace}
                  key={workspace.id}
                  onClick={() => void handleWorkspaceSwitch(workspace.id)}
                  type="button"
                >
                  <span className="block truncate">{workspace.name}</span>
                  {workspace.isScheduledForDeletion ? (
                    <span className="block text-xs text-destructive">Deletion scheduled</span>
                  ) : null}
                </Button>
              )
            })}
          </div>
        ) : null}
        {workspaceError ? (
          <p className="px-2 pb-2 text-xs text-destructive">{workspaceError}</p>
        ) : null}
        <div className="grid gap-1 py-2">
          <Link className="rounded-md px-2 py-2 text-sm hover:bg-muted" href="/workspace/new-team">
            Create workspace
          </Link>
          <Link className="rounded-md px-2 py-2 text-sm hover:bg-muted" href="/assets">
            Assets
          </Link>
          <Link className="rounded-md px-2 py-2 text-sm hover:bg-muted" href="/activity">
            Activity
          </Link>
          <Link className="rounded-md px-2 py-2 text-sm hover:bg-muted" href="/workspace">
            Workspace settings
          </Link>
        </div>
        <Button variant="custom" size={null}
          className="w-full rounded-md px-2 py-2 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSigningOut}
          onClick={handleSignOut}
          type="button"
        >
          {isSigningOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

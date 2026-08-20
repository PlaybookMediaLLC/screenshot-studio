'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { authClient } from '@/lib/auth/client'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTRPCClient } from '@/lib/trpc/react'

function getInitial(name: string | null | undefined, email: string): string {
  return (name || email).trim().charAt(0).toUpperCase()
}

type Workspace = { id: string; isScheduledForDeletion: boolean; name: string; slug: string }

export function AccountMenu() {
  const router = useRouter()
  const trpcClient = useTRPCClient()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const { data: session, isPending } = authClient.useSession()

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
    router.push('/sign-in')
    router.refresh()
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

  if (isPending) return <div aria-hidden className="h-8 w-8" />

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
        <button
          aria-label="Open account menu"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background transition-opacity hover:opacity-80"
          type="button"
        >
          {getInitial(session.user.name, session.user.email)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="border-b px-2 py-2.5">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
        </div>
        {canSwitchWorkspace ? (
          <div className="grid gap-1 border-b py-2">
            <p className="px-2 text-xs font-medium text-muted-foreground">Workspaces</p>
            {workspaces.map((workspace) => {
              const isActive = workspace.id === session.session.activeOrganizationId
              return (
                <button
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
                </button>
              )
            })}
          </div>
        ) : null}
        {workspaceError ? (
          <p className="px-2 pb-2 text-xs text-destructive">{workspaceError}</p>
        ) : null}
        <div className="grid gap-1 py-2">
          <Link className="rounded-md px-2 py-2 text-sm hover:bg-muted" href="/onboarding">
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
        <button
          className="w-full rounded-md px-2 py-2 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSigningOut}
          onClick={handleSignOut}
          type="button"
        >
          {isSigningOut ? 'Signing out…' : 'Sign out'}
        </button>
      </PopoverContent>
    </Popover>
  )
}

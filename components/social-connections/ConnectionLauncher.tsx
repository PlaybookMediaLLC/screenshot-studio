'use client'

import dynamic from 'next/dynamic'
import { useState, type ReactNode } from 'react'
import type { z } from 'zod'
import type { socialOAuthBeginRequestSchema } from 'screenshot-studio-backend-sdk'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { useSocialSetScope } from '@/components/settings/social-sets/scope'
import type { SocialSetRecord } from '@/components/settings/social-sets/api'

const ConnectionDialog = dynamic(() => import('./ConnectionDialog'))

/** The persisted attempt contract supplies the intent; display names never select its target. */
export type ConnectionLauncherProps = {
  children: ReactNode
  intent: Omit<z.input<typeof socialOAuthBeginRequestSchema>, 'provider'>
  target?: Pick<SocialSetRecord, 'name' | 'accounts'>
  initialProvider?: z.input<typeof socialOAuthBeginRequestSchema>['provider']
}

function Launcher(props: ConnectionLauncherProps) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.children}</DialogTrigger>
      {open ? <ConnectionDialog {...props} onClose={() => setOpen(false)} /> : null}
    </Dialog>
  )
}

/** Open over the current page, resetting the flow when its signed-in workspace changes. */
export function ConnectionLauncher(props: ConnectionLauncherProps) {
  const scope = useSocialSetScope()
  return <Launcher key={`${scope.userId}:${scope.workspaceId}`} {...props} />
}

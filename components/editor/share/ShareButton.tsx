'use client'

import * as React from 'react'
import { Share08Icon } from 'hugeicons-react'
import { useHydratedSession } from '@/lib/auth/client'
import { cn } from '@/lib/utils'
import { ShareDialog } from './ShareDialog'

/** The editor's Share button: publish the design at a link (signed-in workspaces only). */
export function ShareButton({
  compact = false,
  disabled,
  render,
}: {
  compact?: boolean
  disabled: boolean
  render: () => Promise<Blob>
}) {
  const { data: session, isPending } = useHydratedSession()
  const [open, setOpen] = React.useState(false)
  if (isPending || !session) return null
  return (
    <>
      <button
        aria-label="Share"
        className={cn(
          'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg text-[13px] font-medium text-muted-foreground',
          'transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-35',
          compact ? 'px-2' : 'px-2.5'
        )}
        disabled={disabled}
        onClick={() => setOpen(true)}
        type="button"
      >
        <Share08Icon size={15} />
        {!compact ? <span>Share</span> : null}
      </button>
      <ShareDialog onOpenChange={setOpen} open={open} render={render} />
    </>
  )
}

'use client'

import { ShareIcon as Share08Icon } from '@phosphor-icons/react/dist/ssr/Share'
import { useHydratedSession } from '@/lib/auth/client'
import { cn } from '@/lib/utils'
import { ShareDialog } from './ShareDialog'
import { Button } from '@/components/ui/button'

/**
 * The editor's Share button: publish the design at a link (signed-in
 * workspaces only). Controlled, so the export menu's Embed entry opens it too.
 */
export function ShareButton({
  compact = false,
  disabled,
  onOpenChange: setOpen,
  open,
  render,
}: {
  compact?: boolean
  disabled: boolean
  onOpenChange: (open: boolean) => void
  open: boolean
  render: () => Promise<Blob>
}) {
  const { data: session, isPending } = useHydratedSession()
  if (isPending || !session) return null
  return (
    <>
      <Button variant="custom" size={null}
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
      </Button>
      <ShareDialog onOpenChange={setOpen} open={open} render={render} />
    </>
  )
}

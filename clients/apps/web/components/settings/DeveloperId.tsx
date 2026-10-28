'use client'

import { toast } from 'sonner'
import { useDeveloperMode } from '@/components/settings/PreferencesProvider'
import { Button } from '@/components/ui/button'

/**
 * A stable ID with a copy button, shown only in development mode (RFC 024).
 * It shows the resource's own ID, never a credential or another workspace's.
 */
export function DeveloperId({ id, label }: { id: string; label: string }) {
  const developerMode = useDeveloperMode()
  if (!developerMode) return null
  return (
    <Button
      aria-label={`Copy ${label} ID ${id}`}
      className="inline-flex items-center gap-1.5 rounded-md bg-foreground/[0.05] px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={async () => {
        await navigator.clipboard.writeText(id)
        toast.success(`${label} ID copied.`)
      }}
      size={null}
      title={`${label} ID`}
      type="button"
      variant="custom"
    >
      <span className="text-muted-foreground/75">{label}</span>
      {id}
    </Button>
  )
}

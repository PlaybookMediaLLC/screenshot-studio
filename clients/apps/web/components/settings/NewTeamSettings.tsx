'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { WorkspaceCreationDialog } from '@/components/workspace/WorkspaceCreationDialog'

/** Settings entry into the same creation dialog used by the account menu. */
export function NewTeamSettings({ email, userId }: { email: string; userId: string }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <div className="grid justify-items-start gap-4">
      <p className="text-sm text-muted-foreground">
        Create a separate workspace for a team, project, or client. Your current workspace stays
        selected.
      </p>
      <Button ref={trigger} onClick={() => setOpen(true)}>
        Create workspace
      </Button>
      {open ? (
        <WorkspaceCreationDialog
          key={userId}
          email={email}
          userId={userId}
          onClose={() => setOpen(false)}
          returnFocusRef={trigger}
        />
      ) : null}
    </div>
  )
}

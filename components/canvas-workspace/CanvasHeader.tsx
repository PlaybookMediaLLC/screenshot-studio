'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { CanvasSession, CanvasSessionState } from '@/lib/canvas/session'
import { useCanvasUi } from '@/lib/canvas/ui-store'
import { cn } from '@/lib/utils'
import { RenameDialog } from './CanvasLibrary'
import type { CanvasActions } from './use-canvas-actions'
import type { CanvasDialog } from './CanvasDialogs'

const STATUS: Record<CanvasSessionState['status'], string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  offline: 'Offline · kept on this device',
  conflict: 'Save conflict',
  error: 'Not saved',
}

/** Name, save state, undo and redo, and the document-wide actions. */
export function CanvasHeader({
  session,
  state,
  actions,
  canEdit,
  canHandOff,
  onDialog,
  presence,
}: {
  session: CanvasSession
  state: CanvasSessionState
  actions: CanvasActions
  canEdit: boolean
  canHandOff: boolean
  onDialog: (dialog: CanvasDialog) => void
  /** Who else has this canvas open. */
  presence?: React.ReactNode
}) {
  const [name, setName] = useState(session.record.name)
  const [renaming, setRenaming] = useState(false)
  const leftOpen = useCanvasUi((ui) => ui.leftOpen)
  const rightOpen = useCanvasUi((ui) => ui.rightOpen)
  const togglePanel = useCanvasUi((ui) => ui.togglePanel)
  const status = STATUS[state.status]
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
      <Link
        href="/canvas"
        aria-label="Back to Canvas"
        className="rounded px-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={(event) => {
          try {
            actions.exitEdit()
          } catch {
            event.preventDefault()
          }
        }}
      >
        ← Canvas
      </Link>
      <Button
        variant="ghost"
        size="sm"
        className="max-w-[40vw] truncate font-semibold"
        disabled={!canEdit}
        onClick={() => setRenaming(true)}
        title="Rename canvas"
      >
        <h1 className="truncate">{name}</h1>
      </Button>
      <span
        role="status"
        data-testid="canvas-save-status"
        title={`Revision ${state.revision}`}
        className={cn(
          'rounded-full px-2 py-0.5 text-xs',
          state.status === 'saved' && 'text-muted-foreground',
          (state.status === 'unsaved' || state.status === 'saving') &&
            'bg-foreground/[0.05] text-muted-foreground',
          (state.status === 'offline' || state.status === 'conflict' || state.status === 'error') &&
            'bg-amber-500/15 text-amber-700 dark:text-amber-300'
        )}
      >
        {status}
      </span>
      {presence}
      <div className="ml-auto flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={leftOpen}
          className="hidden md:inline-flex"
          onClick={() => togglePanel('left')}
        >
          Tools
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={rightOpen}
          className="hidden md:inline-flex"
          onClick={() => togglePanel('right')}
        >
          Properties
        </Button>
        {canEdit ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!state.canUndo}
                  onClick={() => actions.undo()}
                >
                  Undo
                </Button>
              </TooltipTrigger>
              <TooltipContent>⌘Z</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!state.canRedo}
                  onClick={() => actions.redo()}
                >
                  Redo
                </Button>
              </TooltipTrigger>
              <TooltipContent>⇧⌘Z</TooltipContent>
            </Tooltip>
          </>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => onDialog('history')}>
          History
        </Button>
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={() => onDialog('brand')}>
            Brand
          </Button>
        ) : null}
        {canEdit && canHandOff ? (
          <Button variant="outline" size="sm" onClick={() => onDialog('campaign')}>
            Campaign…
          </Button>
        ) : null}
        <Button size="sm" onClick={() => onDialog('export')}>
          Export
        </Button>
      </div>
      {renaming ? (
        <RenameDialog
          name={name}
          onClose={() => setRenaming(false)}
          onSave={async (next) => {
            const record = await session.client.canvas.rename.mutate({
              canvasId: session.record.id,
              name: next,
            })
            setName(record.name)
            setRenaming(false)
          }}
        />
      ) : null}
    </header>
  )
}

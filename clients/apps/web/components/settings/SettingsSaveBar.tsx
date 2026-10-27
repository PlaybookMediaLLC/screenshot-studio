import { type ReactNode } from 'react'
import { CheckIcon } from '@/components/platform-shell/icons'
import { Button } from '@/components/ui/button'

/**
 * A consistent save boundary for one independently saved settings form. With
 * nothing to save it is a quiet status line; changes bring up the sticky bar
 * with Discard and Save.
 */
export function SettingsSaveBar({
  dirty,
  busy,
  disabled,
  label = 'Save changes',
  onDiscard,
  onSave,
  children,
}: {
  dirty: boolean
  busy?: boolean
  disabled?: boolean
  label?: string
  onDiscard: () => void
  onSave?: () => void
  children?: ReactNode
}) {
  if (!dirty && !busy)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <CheckIcon size={14} aria-hidden="true" />
          All changes saved
        </p>
        {children}
      </div>
    )
  return (
    // Flush with the panel's bottom on an opaque strip that fades upward, so
    // the sections scrolling under it are covered cleanly, not sliced at its edges.
    <div
      className="pointer-events-none sticky bottom-0 z-10 bg-[linear-gradient(to_top,var(--card)_65%,transparent)] pt-6 pb-4"
      data-settings-save-bar
    >
      <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-3 shadow-sm">
        <p className="mr-auto text-sm" role="status">
          {busy ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}
        </p>
        <Button type="button" variant="outline" disabled={!dirty || busy} onClick={onDiscard}>
          Discard
        </Button>
        <Button
          type={onSave ? 'button' : 'submit'}
          onClick={onSave}
          disabled={!dirty || busy || disabled}
        >
          {busy ? 'Saving…' : label}
        </Button>
        {children}
      </div>
    </div>
  )
}

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
    <div
      className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-3 shadow-sm"
      data-settings-save-bar
    >
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
  )
}

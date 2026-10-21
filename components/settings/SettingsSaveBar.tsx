import { type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/** A consistent save boundary for one independently saved settings form. */
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
  return (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-3 shadow-sm">
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

'use client'

import { type ReactNode, useId, useState } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * A confirmation for a sensitive or destructive action. It stays open while
 * the action runs and closes only when it succeeds; a failure shows in the
 * dialog. With `confirmText`, the action unlocks once that text is typed.
 */
export function ConfirmDialog({
  children,
  confirmLabel,
  confirmText,
  description,
  destructive,
  disabled,
  onConfirm,
  title,
  triggerLabel,
}: {
  children?: ReactNode
  confirmLabel: string
  /** Text the person types to unlock the action, such as a name. */
  confirmText?: string
  description: ReactNode
  destructive?: boolean
  disabled?: boolean
  /** Resolves to an error message, or null when it succeeded. */
  onConfirm: (typed: string) => Promise<string | null>
  title: string
  triggerLabel: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locked = confirmText !== undefined && typed.trim() !== confirmText

  const confirm = async () => {
    setRunning(true)
    setError(null)
    const failure = await onConfirm(typed.trim())
    setRunning(false)
    if (failure) {
      setError(failure)
      return
    }
    setOpen(false)
    setTyped('')
  }

  return (
    <AlertDialog
      onOpenChange={(next) => {
        if (running) return
        setOpen(next)
        if (!next) {
          setError(null)
          setTyped('')
        }
      }}
      open={open}
    >
      <AlertDialogTrigger asChild>
        <Button disabled={disabled} type="button" variant={destructive ? 'destructive' : 'outline'}>
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-2 text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {confirmText !== undefined ? (
          <label className="grid gap-1 text-sm" htmlFor={`${id}-confirm`}>
            <span className="text-foreground">
              Type <strong className="font-medium">{confirmText}</strong> to confirm
            </span>
            <Input autoComplete="off" id={`${id}-confirm`} onChange={(event) => setTyped(event.target.value)} value={typed} />
          </label>
        ) : null}
        {error ? (
          <p className="text-sm text-red-700 dark:text-red-300" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>Cancel</AlertDialogCancel>
          <Button
            disabled={locked || running}
            onClick={() => void confirm()}
            type="button"
            variant={destructive ? 'destructive' : 'default'}
          >
            {running ? 'Working…' : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Ask for a name (a new project, a rename, a named version) and run `onSubmit`
 * with it. The dialog stays open with the error when the submit fails.
 */
export function ProjectNameDialog({
  description,
  initialName = '',
  label,
  maxLength,
  onOpenChange,
  onSubmit,
  open,
  submitLabel,
  title,
}: {
  description?: string
  initialName?: string
  label: string
  maxLength: number
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => Promise<void>
  open: boolean
  submitLabel: string
  title: string
}) {
  const [name, setName] = React.useState(initialName)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const inputId = React.useId()

  React.useEffect(() => {
    if (open) {
      setName(initialName)
      setError(null)
    }
  }, [initialName, open])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a name.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      onOpenChange(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That did not work. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog onOpenChange={pending ? undefined : onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[420px]">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={inputId}>{label}</Label>
            <Input
              aria-describedby={error ? `${inputId}-error` : undefined}
              aria-invalid={Boolean(error)}
              autoFocus
              id={inputId}
              maxLength={maxLength}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
            {error ? (
              <p className="text-xs text-destructive" id={`${inputId}-error`} role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={pending} type="submit">
              {pending ? 'Saving…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

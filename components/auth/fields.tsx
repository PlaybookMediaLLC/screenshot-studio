import { ArrowRight, Loader2 } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Shared look for the auth and onboarding forms. */
export const authInputClassName =
  'h-10 rounded-lg border-white/[0.08] bg-white/[0.03] px-3.5 md:text-sm dark:bg-white/[0.03]'

type AuthFieldProps = ComponentProps<typeof Input> & { hint?: ReactNode; id: string; label: string }

export function AuthField({ className, hint, id, label, ...props }: AuthFieldProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-neutral-300" htmlFor={id}>
        {label}
      </label>
      <Input className={cn(authInputClassName, className)} id={id} {...props} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function FormAlert({
  children,
  tone = 'error',
}: {
  children: ReactNode
  tone?: 'error' | 'info'
}) {
  return (
    <p
      className={cn(
        'rounded-lg border px-3.5 py-3 text-sm',
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-foreground/10 bg-muted/40 text-foreground'
      )}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </p>
  )
}

export function SubmitButton({
  busy,
  busyLabel,
  children,
  disabled,
}: {
  busy: boolean
  busyLabel: string
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <Button className="h-10 w-full rounded-lg px-4" disabled={disabled || busy} type="submit">
      {busy ? (
        <>
          <Loader2 aria-hidden className="animate-spin" />
          {busyLabel}
        </>
      ) : (
        <>
          {children}
          <ArrowRight aria-hidden />
        </>
      )}
    </Button>
  )
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-6 text-sm text-neutral-500">
      <span className="h-px flex-1 bg-white/[0.08]" />
      {children}
      <span className="h-px flex-1 bg-white/[0.08]" />
    </div>
  )
}

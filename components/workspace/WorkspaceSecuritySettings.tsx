'use client'

import { type FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth/client'
import { getAuthErrorMessage } from '@/components/auth/error-message'

const codeSchema = z.string().regex(/^\d{6}$/, 'Enter the six-digit code from your authenticator.')

type SetupState = { backupCodes: string[]; totpURI: string }
type WorkspaceSecuritySettingsProps = { twoFactorEnabled: boolean }

export function WorkspaceSecuritySettings({ twoFactorEnabled }: WorkspaceSecuritySettingsProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [setup, setSetup] = useState<SetupState | null>(null)

  async function enableTwoFactor(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const password = String(new FormData(event.currentTarget).get('password') ?? '')
      const result = await authClient.twoFactor.enable({ password })
      if (result.error || !result.data)
        throw new Error(result.error?.message ?? 'Could not start two-factor setup.')
      setSetup(result.data)
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, 'Could not start two-factor setup.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function verifyTwoFactor(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    const code = codeSchema.safeParse(new FormData(event.currentTarget).get('code'))
    if (!code.success) {
      setError(code.error.issues[0]?.message ?? 'Enter a valid code.')
      return
    }
    setIsSubmitting(true)
    try {
      const result = await authClient.twoFactor.verifyTotp({ code: code.data })
      if (result.error) throw new Error(result.error.message ?? 'The code could not be verified.')
      router.refresh()
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, 'The code could not be verified.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function disableTwoFactor(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const password = String(new FormData(event.currentTarget).get('password') ?? '')
      const result = await authClient.twoFactor.disable({ password })
      if (result.error)
        throw new Error(result.error.message ?? 'Could not disable two-factor authentication.')
      router.refresh()
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, 'Could not disable two-factor authentication.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (twoFactorEnabled)
    return (
      <EnabledSecurityForm error={error} isSubmitting={isSubmitting} onSubmit={disableTwoFactor} />
    )
  if (setup)
    return (
      <VerifySecurityForm
        error={error}
        isSubmitting={isSubmitting}
        onSubmit={verifyTwoFactor}
        setup={setup}
      />
    )
  return <EnableSecurityForm error={error} isSubmitting={isSubmitting} onSubmit={enableTwoFactor} />
}

function EnableSecurityForm({
  error,
  isSubmitting,
  onSubmit,
}: {
  error: string | null
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <form className="grid max-w-xl gap-5" onSubmit={onSubmit}>
      <p className="text-sm text-muted-foreground">
        Add a time-based authenticator to protect sensitive workspace actions.
      </p>
      <PasswordField />
      <FormError error={error} />
      <Button className="w-fit" disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Starting…' : 'Set up authenticator'}
      </Button>
    </form>
  )
}

function VerifySecurityForm({
  error,
  isSubmitting,
  onSubmit,
  setup,
}: {
  error: string | null
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  setup: SetupState
}) {
  return (
    <form className="grid max-w-xl gap-5" onSubmit={onSubmit}>
      <p className="text-sm text-muted-foreground">
        Add this URI to your authenticator, store the backup codes, then enter the generated code.
      </p>
      <code className="overflow-x-auto rounded-md border border-foreground/10 bg-background p-3 text-xs">
        {setup.totpURI}
      </code>
      <div className="grid grid-cols-2 gap-2 rounded-md border border-foreground/10 bg-background p-3 text-xs">
        {setup.backupCodes.map((backupCode) => (
          <code key={backupCode}>{backupCode}</code>
        ))}
      </div>
      <Label className="grid gap-1.5" htmlFor="two-factor-code">
        Verification code
        <Input
          autoComplete="one-time-code"
          className="h-10 rounded-md border border-foreground/10 bg-background px-3"
          id="two-factor-code"
          inputMode="numeric"
          name="code"
          required
        />
      </Label>
      <FormError error={error} />
      <Button className="w-fit" disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Verifying…' : 'Verify and enable'}
      </Button>
    </form>
  )
}

function EnabledSecurityForm({
  error,
  isSubmitting,
  onSubmit,
}: {
  error: string | null
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <form className="grid max-w-xl gap-5" onSubmit={onSubmit}>
      <p className="text-sm text-muted-foreground">
        Two-factor authentication is enabled for this account.
      </p>
      <PasswordField />
      <FormError error={error} />
      <Button disabled={isSubmitting} type="submit" variant="outline">
        {isSubmitting ? 'Disabling…' : 'Disable two-factor authentication'}
      </Button>
    </form>
  )
}

function PasswordField() {
  return (
    <Label className="grid gap-1.5" htmlFor="two-factor-password">
      Current password
      <Input
        autoComplete="current-password"
        className="h-10 rounded-md border border-foreground/10 bg-background px-3"
        id="two-factor-password"
        name="password"
        required
        type="password"
      />
    </Label>
  )
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null
}

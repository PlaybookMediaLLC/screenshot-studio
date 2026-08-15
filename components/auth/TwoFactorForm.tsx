'use client'

import Link from 'next/link'
import { type FormEvent, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { z } from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth/client'
import { getAuthErrorMessage } from './error-message'

const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the six-digit code.')
const backupCodeSchema = z.string().trim().min(1, 'Enter a recovery code.')

function getCallbackUrl(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export function TwoFactorForm() {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const [isBackupCode, setIsBackupCode] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [trustDevice, setTrustDevice] = useState(false)
  const callbackURL = getCallbackUrl(searchParams.get('callbackURL'))

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  async function verifyCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    const code = (isBackupCode ? backupCodeSchema : totpCodeSchema).safeParse(
      new FormData(event.currentTarget).get('code')
    )
    if (!code.success) {
      setError(code.error.issues[0]?.message ?? 'Enter a valid verification code.')
      return
    }

    setIsSubmitting(true)
    try {
      const result = isBackupCode
        ? await authClient.twoFactor.verifyBackupCode({ code: code.data, trustDevice })
        : await authClient.twoFactor.verifyTotp({ code: code.data, trustDevice })
      if (result.error) throw new Error(result.error.message ?? 'Verification failed.')
      window.location.assign(callbackURL)
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, 'Verification failed. Try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputLabel = isBackupCode ? 'Recovery code' : 'Authenticator code'
  return (
    <form className="space-y-4" onSubmit={verifyCode}>
      <label className="grid gap-1.5 text-sm font-medium" htmlFor="two-factor-code">
        {inputLabel}
        <Input
          autoComplete="one-time-code"
          id="two-factor-code"
          inputMode={isBackupCode ? 'text' : 'numeric'}
          name="code"
          required
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          checked={trustDevice}
          disabled={!isHydrated}
          onChange={(event) => setTrustDevice(event.target.checked)}
          type="checkbox"
        />
        Trust this device for 30 days
      </label>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button className="w-full" disabled={!isHydrated || isSubmitting} type="submit">
        {isSubmitting ? 'Verifying…' : 'Verify and sign in'}
      </Button>
      <Button
        className="w-full"
        disabled={!isHydrated}
        onClick={() => setIsBackupCode((value) => !value)}
        type="button"
        variant="outline"
      >
        {isBackupCode ? 'Use an authenticator code' : 'Use a recovery code'}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link className="font-medium text-foreground underline" href="/sign-in">
          Return to sign in
        </Link>
      </p>
    </form>
  )
}

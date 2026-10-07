'use client'

import { KeyRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { getAuthErrorMessage } from './error-message'
import { AuthField, FormAlert, SubmitButton } from './fields'

const ssoSignInSchema = z.object({ email: z.string().trim().email('Enter a valid work email.') })
const ssoRedirectSchema = z.object({ url: z.string().url() })

type SsoSignInFormProps = { callbackURL: string }

export function SsoSignInForm({ callbackURL }: SsoSignInFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    const input = ssoSignInSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)))
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? 'Check the work email address.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/auth/sign-in/sso', {
        body: JSON.stringify({
          callbackURL: new URL(callbackURL, window.location.origin).toString(),
          email: input.data.email,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      const body: unknown = await response.json()
      if (!response.ok) {
        throw new Error('SSO sign-in is unavailable. Check your work email address.')
      }
      window.location.assign(ssoRedirectSchema.parse(body).url)
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, 'SSO sign-in failed. Please try again.'))
      setIsSubmitting(false)
    }
  }

  if (!isOpen) {
    return (
      <Button
        className="h-11 w-full rounded-lg"
        onClick={() => setIsOpen(true)}
        type="button"
        variant="outline"
      >
        <KeyRound aria-hidden />
        Use single sign-on
      </Button>
    )
  }

  return (
    <form className="space-y-4 rounded-xl border bg-muted/20 p-4" onSubmit={handleSubmit}>
      <AuthField
        autoComplete="email"
        autoFocus
        hint="We'll send you to your company's identity provider."
        id="sso-email"
        label="Work email"
        name="email"
        placeholder="you@company.com"
        required
        type="email"
      />
      {error ? <FormAlert>{error}</FormAlert> : null}
      <SubmitButton busy={isSubmitting} busyLabel="Redirecting…">
        Continue with SSO
      </SubmitButton>
    </form>
  )
}

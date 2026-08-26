'use client'

import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getAuthErrorMessage } from './error-message'

const ssoSignInSchema = z.object({ email: z.string().trim().email('Enter a valid work email.') })
const ssoRedirectSchema = z.object({ url: z.string().url() })

type SsoSignInFormProps = { callbackURL: string }

export function SsoSignInForm({ callbackURL }: SsoSignInFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  return (
    <form className="space-y-3 border-t border-border pt-4" onSubmit={handleSubmit}>
      <div>
        <p className="text-sm font-medium">Use single sign-on</p>
        <p className="text-sm text-muted-foreground">Use your company email to continue.</p>
      </div>
      <label className="grid gap-1.5 text-sm font-medium" htmlFor="sso-email">
        Work email
        <Input autoComplete="email" id="sso-email" name="email" required type="email" />
      </label>
      {error ? (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="w-full" disabled={isSubmitting} type="submit" variant="outline">
        {isSubmitting ? 'Redirecting…' : 'Continue with SSO'}
      </Button>
    </form>
  )
}

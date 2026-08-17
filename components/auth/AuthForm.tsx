'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'
import { getAuthErrorMessage } from './error-message'
import { SsoSignInForm } from './SsoSignInForm'

const signInSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

const signUpSchema = signInSchema.extend({
  name: z.string().trim().min(1, 'Enter your name.').max(100),
  password: z.string().min(12, 'Use at least 12 characters.'),
})

type AuthFormProps = {
  mode: 'sign-in' | 'sign-up'
}

function getCallbackUrl(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export function AuthForm({ mode }: AuthFormProps) {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSignUp = mode === 'sign-up'
  const callbackURL = getCallbackUrl(searchParams.get('callbackURL'))

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    setIsSubmitting(true)
    try {
      if (isSignUp) {
        const input = signUpSchema.safeParse(values)
        if (!input.success) {
          setError(input.error.issues[0]?.message ?? 'Check the form values.')
          return
        }
        const result = await authClient.signUp.email({ ...input.data, callbackURL })
        if (result.error)
          throw new Error(
            result.error.message || 'Account creation is unavailable. Please try again.'
          )
        if (result.data?.token) {
          window.location.assign(callbackURL === '/' ? '/onboarding' : callbackURL)
          return
        }
        setMessage('Check your email to verify your account, then sign in.')
        form.reset()
      } else {
        const input = signInSchema.safeParse(values)
        if (!input.success) {
          setError(input.error.issues[0]?.message ?? 'Check the form values.')
          return
        }
        const result = await authClient.signIn.email({ ...input.data, callbackURL })
        if (result.error)
          throw new Error(result.error.message || 'Sign-in is unavailable. Please try again.')
        if (result.data && 'twoFactorRedirect' in result.data && result.data.twoFactorRedirect)
          return
        window.location.assign(callbackURL)
      }
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, 'Authentication failed. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSocialSignIn(provider: 'github' | 'google' | 'microsoft') {
    setError(null)
    const result = await authClient.signIn.social({ callbackURL, provider })
    if (result.error) setError(result.error.message || 'Social sign-in failed. Please try again.')
  }

  return (
    <div className="space-y-4">
      <form className="space-y-4" onSubmit={handleSubmit}>
        {isSignUp ? (
          <label className="grid gap-1.5 text-sm font-medium" htmlFor="name">
            Name
            <input
              autoComplete="name"
              className="h-10 rounded-md border bg-background px-3"
              id="name"
              name="name"
              required
            />
          </label>
        ) : null}
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="email">
          Email
          <input
            autoComplete="email"
            className="h-10 rounded-md border bg-background px-3"
            id="email"
            name="email"
            required
            type="email"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="password">
          Password
          <input
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            className="h-10 rounded-md border bg-background px-3"
            id="password"
            minLength={isSignUp ? 12 : undefined}
            name="password"
            required
            type="password"
          />
        </label>
        {error ? (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        ) : null}
        {message ? (
          <p className="rounded-md bg-primary/10 p-3 text-sm text-foreground">{message}</p>
        ) : null}
        <Button className="w-full" disabled={!isHydrated || isSubmitting} type="submit">
          {isSubmitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
        </Button>
        <div className="relative py-2 text-center text-xs text-muted-foreground before:absolute before:inset-x-0 before:top-1/2 before:border-t before:border-border">
          <span className="relative bg-background px-2">or continue with</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['google', 'microsoft', 'github'] as const).map((provider) => (
            <Button
              key={provider}
              onClick={() => handleSocialSignIn(provider)}
              type="button"
              variant="outline"
            >
              {provider[0].toUpperCase() + provider.slice(1)}
            </Button>
          ))}
        </div>
        <p className="text-center text-sm text-muted-foreground">
          {isSignUp ? 'Already have an account?' : 'Need an account?'}{' '}
          <Link
            className="font-medium text-foreground underline"
            href={`${isSignUp ? '/sign-in' : '/sign-up'}?callbackURL=${encodeURIComponent(callbackURL)}`}
          >
            {isSignUp ? 'Sign in' : 'Create one'}
          </Link>
        </p>
      </form>
      {!isSignUp ? <SsoSignInForm callbackURL={callbackURL} /> : null}
    </div>
  )
}

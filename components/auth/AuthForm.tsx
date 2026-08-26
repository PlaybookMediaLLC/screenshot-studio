'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'
import type { SocialProvider } from '@/lib/auth/methods'
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

const PROVIDER_LABELS: Record<SocialProvider, string> = {
  github: 'GitHub',
  google: 'Google',
  microsoft: 'Microsoft',
}

type AuthFormProps = {
  mode: 'sign-in' | 'sign-up'
  /** Providers with credentials configured. Rendering a provider the server
   * cannot service produces an opaque failure when the user clicks it. */
  socialProviders: SocialProvider[]
  passwordAuthEnabled: boolean
}

function getCallbackUrl(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export function AuthForm({ mode, passwordAuthEnabled, socialProviders }: AuthFormProps) {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSignUp = mode === 'sign-up'
  const callbackURL = getCallbackUrl(searchParams.get('callbackURL'))
  const hasSocialProviders = socialProviders.length > 0

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

  async function handleSocialSignIn(provider: SocialProvider) {
    setError(null)
    const result = await authClient.signIn.social({ callbackURL, provider })
    if (result.error) setError(result.error.message || 'Social sign-in failed. Please try again.')
  }

  return (
    <div className="space-y-4">
      {passwordAuthEnabled ? (
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
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </p>
          ) : null}
          {message ? (
            <p className="rounded-md bg-primary/10 p-3 text-sm text-foreground">{message}</p>
          ) : null}
          <Button className="w-full" disabled={!isHydrated || isSubmitting} type="submit">
            {isSubmitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
          </Button>
        </form>
      ) : null}

      {passwordAuthEnabled && hasSocialProviders ? (
        <div className="relative py-2 text-center text-xs text-muted-foreground before:absolute before:inset-x-0 before:top-1/2 before:border-t before:border-border">
          <span className="relative bg-background px-2">or continue with</span>
        </div>
      ) : null}

      {!passwordAuthEnabled && error ? (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {hasSocialProviders ? (
        <div
          className={
            socialProviders.length > 2 ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-1 gap-2'
          }
        >
          {socialProviders.map((provider) => (
            <Button
              key={provider}
              onClick={() => handleSocialSignIn(provider)}
              type="button"
              variant="outline"
            >
              {socialProviders.length > 2
                ? PROVIDER_LABELS[provider]
                : `Continue with ${PROVIDER_LABELS[provider]}`}
            </Button>
          ))}
        </div>
      ) : null}

      {passwordAuthEnabled ? (
        <p className="text-center text-sm text-muted-foreground">
          {isSignUp ? 'Already have an account?' : 'Need an account?'}{' '}
          <Link
            className="font-medium text-foreground underline"
            href={`${isSignUp ? '/sign-in' : '/sign-up'}?callbackURL=${encodeURIComponent(callbackURL)}`}
          >
            {isSignUp ? 'Sign in' : 'Create one'}
          </Link>
        </p>
      ) : null}

      {!isSignUp ? <SsoSignInForm callbackURL={callbackURL} /> : null}
    </div>
  )
}

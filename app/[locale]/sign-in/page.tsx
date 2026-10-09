import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Suspense } from 'react'
import { AuthForm } from '@/components/auth/AuthForm'
import { AuthShell } from '@/components/auth/AuthShell'
import { getEnabledSocialProviders, isPasswordAuthEnabled } from '@/lib/auth/methods'
import { redirectIfSignedIn } from '@/lib/auth/page-access'

export const metadata: Metadata = { title: 'Sign in | Screenshot Studio' }

type AuthPageProps = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ callbackURL?: string | string[] }>
}

export default async function SignInPage({ params, searchParams }: AuthPageProps) {
  const [{ locale }, { callbackURL }, requestHeaders] = await Promise.all([
    params,
    searchParams,
    headers(),
  ])
  await redirectIfSignedIn(requestHeaders, locale, callbackURL)

  return (
    <AuthShell description="Sign in to access your team workspace." title="Welcome back">
      <Suspense fallback={null}>
        <AuthForm
          mode="sign-in"
          passwordAuthEnabled={isPasswordAuthEnabled()}
          socialProviders={getEnabledSocialProviders()}
        />
      </Suspense>
    </AuthShell>
  )
}

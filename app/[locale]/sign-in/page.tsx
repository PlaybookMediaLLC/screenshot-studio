import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AuthForm } from '@/components/auth/AuthForm'
import { AuthShell } from '@/components/auth/AuthShell'
import { getEnabledSocialProviders, isPasswordAuthEnabled } from '@/lib/auth/methods'

export const metadata: Metadata = { title: 'Sign in | Screenshot Studio' }

export default function SignInPage() {
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

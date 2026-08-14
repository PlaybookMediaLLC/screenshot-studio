import type { Metadata } from 'next'
import { AuthForm } from '@/components/auth/AuthForm'
import { AuthShell } from '@/components/auth/AuthShell'

export const metadata: Metadata = { title: 'Sign in | Screenshot Studio' }

export default function SignInPage() {
  return (
    <AuthShell description="Sign in to access your team workspace." title="Welcome back">
      <AuthForm mode="sign-in" />
    </AuthShell>
  )
}

import type { Metadata } from 'next'
import { AuthForm } from '@/components/auth/AuthForm'
import { AuthShell } from '@/components/auth/AuthShell'

export const metadata: Metadata = { title: 'Create account | Screenshot Studio' }

export default function SignUpPage() {
  return (
    <AuthShell
      description="Create an account, then set up your team workspace."
      title="Create your account"
    >
      <AuthForm mode="sign-up" />
    </AuthShell>
  )
}

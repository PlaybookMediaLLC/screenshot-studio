import type { Metadata } from 'next'
import { AuthForm } from '@/components/auth/AuthForm'
import { AuthShell } from '@/components/auth/AuthShell'
import { getEnabledSocialProviders, isPasswordAuthEnabled } from '@/lib/auth/methods'

export const metadata: Metadata = { title: 'Create account | Screenshot Studio' }

export default function SignUpPage() {
  return (
    <AuthShell
      description="Create an account, then set up your team workspace."
      title="Create your account"
    >
      <AuthForm
        mode="sign-up"
        passwordAuthEnabled={isPasswordAuthEnabled()}
        socialProviders={getEnabledSocialProviders()}
      />
    </AuthShell>
  )
}

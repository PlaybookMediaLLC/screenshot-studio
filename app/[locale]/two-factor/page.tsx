import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth/AuthShell'
import { TwoFactorForm } from '@/components/auth/TwoFactorForm'

export const metadata: Metadata = { title: 'Verify sign in | Screenshot Studio' }

export default function TwoFactorPage() {
  return (
    <AuthShell description="Enter a code from your authenticator to continue." title="Verify sign in">
      <TwoFactorForm />
    </AuthShell>
  )
}

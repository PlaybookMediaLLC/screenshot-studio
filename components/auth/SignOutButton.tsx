'use client'

import { useState } from 'react'
import { Button, type buttonVariants } from '@/components/ui/button'
import type { VariantProps } from 'class-variance-authority'
import { authClient } from '@/lib/auth/client'

export function SignOutButton({
  className,
  variant = 'outline',
}: {
  className?: string
  variant?: VariantProps<typeof buttonVariants>['variant']
}) {
  const [isSigningOut, setIsSigningOut] = useState(false)

  async function handleSignOut() {
    setIsSigningOut(true)
    await authClient.signOut()
    // A full document load, not router.push + refresh. The router can serve a
    // cached RSC payload for '/' that was rendered while the user still had a
    // session, which leaves the signed-out user sitting on the editor instead
    // of being redirected to sign-in. Sign-up already navigates this way.
    window.location.assign('/')
  }

  return (
    <Button className={className} disabled={isSigningOut} onClick={handleSignOut} variant={variant}>
      {isSigningOut ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}

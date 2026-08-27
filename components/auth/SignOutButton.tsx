'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'

export function SignOutButton() {
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
    <Button disabled={isSigningOut} onClick={handleSignOut} variant="outline">
      {isSigningOut ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}

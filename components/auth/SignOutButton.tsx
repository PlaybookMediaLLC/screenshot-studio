'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'

export function SignOutButton() {
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)

  async function handleSignOut() {
    setIsSigningOut(true)
    await authClient.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <Button disabled={isSigningOut} onClick={handleSignOut} variant="outline">
      {isSigningOut ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}

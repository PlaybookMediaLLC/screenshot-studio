'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'
import { getAuthErrorMessage } from './error-message'

type AcceptInvitationProps = { invitationId: string }

export function AcceptInvitation({ invitationId }: AcceptInvitationProps) {
  const [error, setError] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  async function acceptInvitation(): Promise<void> {
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await authClient.organization.acceptInvitation({ invitationId })
      if (result.error) throw new Error(result.error.message || 'Could not accept the invitation.')
      window.location.assign('/workspace')
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, 'Could not accept the invitation.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="grid gap-5 rounded-lg border border-foreground/10 bg-card p-6">
      <div>
        <h1 className="text-xl font-semibold">Join this workspace</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Confirm that you want to accept this Screenshot Studio invitation.
        </p>
      </div>
      {error ? (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button disabled={!isHydrated || isSubmitting} onClick={() => void acceptInvitation()}>
        {isSubmitting ? 'Joining…' : 'Accept invitation'}
      </Button>
    </div>
  )
}

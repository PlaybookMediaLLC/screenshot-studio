'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'
import { getAuthErrorMessage } from './error-message'

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100),
})

type ProfileFormProps = {
  email: string
  name: string
}

export function ProfileForm({ email, name }: ProfileFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    const input = profileSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)))
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? 'Check the form values.')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await authClient.updateUser(input.data)
      if (result.error) throw new Error(result.error.message || 'Could not update your profile.')
      setMessage('Profile updated.')
      router.refresh()
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, 'Could not update your profile.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <label className="grid gap-1.5 text-sm font-medium" htmlFor="profile-name">
        Name
        <input
          autoComplete="name"
          className="h-10 rounded-md border bg-background px-3"
          defaultValue={name}
          id="profile-name"
          name="name"
          required
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium" htmlFor="profile-email">
        Email
        <input
          className="h-10 cursor-not-allowed rounded-md border bg-muted px-3 text-muted-foreground"
          defaultValue={email}
          disabled
          id="profile-email"
          type="email"
        />
      </label>
      {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {message ? <p className="rounded-md bg-primary/10 p-3 text-sm">{message}</p> : null}
      <Button disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  )
}

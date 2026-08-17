'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
      <Label className="grid gap-1.5" htmlFor="profile-name">
        Name
        <Input
          autoComplete="name"
          className="h-10 rounded-md border bg-background px-3"
          defaultValue={name}
          id="profile-name"
          name="name"
          required
        />
      </Label>
      <Label className="grid gap-1.5" htmlFor="profile-email">
        Email
        <Input
          className="cursor-not-allowed bg-muted text-muted-foreground"
          defaultValue={email}
          disabled
          id="profile-email"
          type="email"
        />
      </Label>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <Button disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  )
}

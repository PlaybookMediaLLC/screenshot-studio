'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Group, Row } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
    <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
      <Group>
        <Row
          description="Shown to your teammates across the workspace."
          label={<label htmlFor="profile-name">Name</label>}
        >
          <Input
            autoComplete="name"
            className="h-10 rounded-lg md:w-72"
            defaultValue={name}
            id="profile-name"
            name="name"
            required
          />
        </Row>
        <Row
          description="Used to sign in. It cannot be changed here."
          label={<label htmlFor="profile-email">Email</label>}
        >
          <Input
            className="h-10 cursor-not-allowed rounded-lg text-neutral-500 md:w-72"
            defaultValue={email}
            disabled
            id="profile-email"
            type="email"
          />
        </Row>
      </Group>
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
      <div className="flex justify-end">
        <Button className="rounded-lg" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </form>
  )
}

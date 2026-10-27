'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Group, Row } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SettingsSaveBar } from '@/components/settings/SettingsSaveBar'
import { useUnsavedSettings } from '@/components/settings/useUnsavedSettings'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth/client'
import { getAuthErrorMessage } from './error-message'
import { Label } from '@/components/ui/label'

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100),
})

type ProfileFormProps = {
  email: string
  name: string
}

export function ProfileForm({ email, name }: ProfileFormProps) {
  const router = useRouter()
  const [savedName, setSavedName] = useState(name)
  const [draftName, setDraftName] = useState(name)
  const dirty = draftName !== savedName
  useUnsavedSettings(dirty)
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
      setSavedName(input.data.name)
      setDraftName(input.data.name)
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
          label={<Label htmlFor="profile-name">Name</Label>}
        >
          <Input
            autoComplete="name"
            className="h-10 rounded-lg md:w-72"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            disabled={isSubmitting}
            maxLength={100}
            id="profile-name"
            name="name"
            required
          />
        </Row>
        <Row
          description="Used to sign in and receive notifications. Use Change email below to update it."
          label={<Label htmlFor="profile-email">Email</Label>}
        >
          <Input
            className="h-10 cursor-not-allowed rounded-lg text-muted-foreground md:w-72"
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
      <SettingsSaveBar
        dirty={dirty}
        busy={isSubmitting}
        disabled={!draftName.trim()}
        label="Save profile"
        onDiscard={() => {
          setDraftName(savedName)
          setError(null)
          setMessage(null)
        }}
      />
    </form>
  )
}

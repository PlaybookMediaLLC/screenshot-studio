'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'
import { getAuthErrorMessage } from './error-message'

const workspaceSchema = z.object({
  name: z.string().trim().min(2, 'Enter a workspace name.').max(100),
})

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function OnboardingForm() {
  const [error, setError] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const input = workspaceSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)))
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? 'Check the workspace name.')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await authClient.organization.create({
        name: input.data.name,
        slug: slugify(input.data.name),
      })
      if (result.error) {
        setError(result.error.message || 'Could not create the workspace.')
        return
      }
      if (!result.data) {
        setError('Could not select the new workspace.')
        return
      }

      const activeOrganization = await authClient.organization.setActive({
        organizationId: result.data.id,
      })
      if (activeOrganization.error) {
        setError(activeOrganization.error.message || 'Could not select the new workspace.')
        return
      }

      window.location.assign('/')
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, 'Could not create the workspace.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <label className="grid gap-1.5 text-sm font-medium" htmlFor="workspace-name">
        Workspace name
        <input
          autoComplete="organization"
          className="h-10 rounded-md border bg-background px-3"
          id="workspace-name"
          name="name"
          placeholder="Acme, Inc."
          required
        />
      </label>
      {error ? (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : null}
      <Button className="w-full" disabled={!isHydrated || isSubmitting} type="submit">
        {isSubmitting ? 'Creating workspace…' : 'Create workspace'}
      </Button>
    </form>
  )
}

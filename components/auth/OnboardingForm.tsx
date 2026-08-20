'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { useTRPCClient } from '@/lib/trpc/react'
import { workspaceCreateSchema } from '@/lib/workspace/input-schemas'
import { getAuthErrorMessage } from './error-message'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function OnboardingForm() {
  const trpcClient = useTRPCClient()
  const [error, setError] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [slug, setSlug] = useState('')

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const input = workspaceCreateSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget))
    )
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? 'Check the workspace name.')
      return
    }

    setIsSubmitting(true)
    try {
      await trpcClient.workspace.create.mutate({
        name: input.data.name,
        slug: input.data.slug,
      })
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
          onChange={(event) => setSlug(slugify(event.target.value))}
          placeholder="Acme, Inc."
          required
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium" htmlFor="workspace-slug">
        Workspace slug
        <input
          className="h-10 rounded-md border bg-background px-3"
          id="workspace-slug"
          name="slug"
          onChange={(event) => setSlug(event.target.value)}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          placeholder="acme-inc"
          required
          value={slug}
        />
        <span className="text-xs font-normal text-muted-foreground">
          Lowercase letters, numbers, and hyphens only.
        </span>
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

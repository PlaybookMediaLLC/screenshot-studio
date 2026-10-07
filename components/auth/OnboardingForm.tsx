'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Input } from '@/components/ui/input'
import { useTRPCClient } from '@/lib/trpc/react'
import { workspaceCreateSchema } from '@/lib/workspace/input-schemas'
import { workspaceInitials } from '@/lib/workspace/initials'
import { getAuthErrorMessage } from './error-message'
import { authInputClassName, FormAlert, SubmitButton } from './fields'

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
  // The inputs stay uncontrolled so text typed before hydration is kept; this
  // state only drives the preview card.
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const slugInputRef = useRef<HTMLInputElement>(null)
  // Once someone types their own slug, the name stops overwriting it.
  const slugEdited = useRef(false)

  function syncSlugFromName(value: string) {
    if (slugEdited.current || !slugInputRef.current) return
    slugInputRef.current.value = slugify(value)
    setSlug(slugInputRef.current.value)
  }

  useEffect(() => {
    setIsHydrated(true)
    const typed = nameInputRef.current?.value ?? ''
    setName(typed)
    if (slugInputRef.current?.value) {
      slugEdited.current = true
      setSlug(slugInputRef.current.value)
    } else {
      syncSlugFromName(typed)
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const formData = new FormData(event.currentTarget)
    const typedName = String(formData.get('name') ?? '')
    const typedSlug = String(formData.get('slug') ?? '').trim()
    const input = workspaceCreateSchema.safeParse({
      name: typedName,
      slug: typedSlug || slugify(typedName),
    })
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
      setIsSubmitting(false)
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="flex items-center gap-4 rounded-xl border bg-muted/30 p-4">
        <div
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-indigo-500 text-base font-semibold text-white shadow-lg shadow-violet-500/20"
        >
          {workspaceInitials(name) || 'W'}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name.trim() || 'Your workspace'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {slug ? `/${slug}` : 'Brand, assets, and campaigns in one place'}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="workspace-name">
          Workspace name
        </label>
        <Input
          autoComplete="organization"
          autoFocus
          className={authInputClassName}
          id="workspace-name"
          name="name"
          onChange={(event) => {
            setName(event.target.value)
            syncSlugFromName(event.target.value)
          }}
          placeholder="Acme, Inc."
          ref={nameInputRef}
          required
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="workspace-slug">
          Workspace slug
        </label>
        <div className="flex h-11 items-center rounded-lg border border-input shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
          <span className="pl-3.5 text-sm text-muted-foreground select-none">/</span>
          <input
            className="h-full min-w-0 flex-1 bg-transparent pr-3.5 pl-1 text-sm outline-none placeholder:text-muted-foreground"
            id="workspace-slug"
            name="slug"
            onChange={(event) => {
              setSlug(event.target.value)
              slugEdited.current = event.target.value !== ''
            }}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            placeholder="acme-inc"
            ref={slugInputRef}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Lowercase letters, numbers, and hyphens. You can change it later.
        </p>
      </div>

      {error ? <FormAlert>{error}</FormAlert> : null}

      <SubmitButton busy={isSubmitting} busyLabel="Creating workspace…" disabled={!isHydrated}>
        Create workspace
      </SubmitButton>
    </form>
  )
}

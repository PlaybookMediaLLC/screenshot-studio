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
    <form className="flex flex-1 flex-col" onSubmit={handleSubmit}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-12">
        <div>
          <h1 className="text-xl font-medium text-white">Create your workspace</h1>
          <p className="mt-1.5 text-neutral-400">
            A shared home for your team&apos;s brand, assets, and campaigns.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-300" htmlFor="workspace-name">
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
            <label className="text-sm font-medium text-neutral-300" htmlFor="workspace-slug">
              Workspace slug
            </label>
            <div className="flex h-10 items-center rounded-lg border border-white/[0.08] bg-white/[0.03] transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
              <span className="pl-3.5 text-sm text-neutral-500 select-none">/</span>
              <input
                className="h-full min-w-0 flex-1 bg-transparent pr-3.5 pl-1 text-sm outline-none placeholder:text-neutral-600"
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
          </div>
        </div>
        <p className="-mt-5 text-xs text-neutral-500">
          The slug uses lowercase letters, numbers, and hyphens. You can change both later.
        </p>

        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-[#1c1c1c] p-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-fuchsia-500 via-violet-500 to-indigo-500 text-xs font-semibold text-white"
          >
            {workspaceInitials(name) || 'W'}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-white">
              {name.trim() || 'Your workspace'}
            </span>
            <span className="block truncate text-xs text-neutral-500">
              {slug ? `/${slug}` : 'Brand, assets, and campaigns'}
            </span>
          </span>
        </div>
        <div className="shrink-0">
          <SubmitButton busy={isSubmitting} busyLabel="Creating workspace…" disabled={!isHydrated}>
            Create workspace
          </SubmitButton>
        </div>
      </div>
    </form>
  )
}

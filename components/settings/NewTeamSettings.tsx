'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Group, Row } from '@/components/platform-ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { settingsErrorMessage } from '@/lib/settings/client'
import { useTRPCClient } from '@/lib/trpc/react'
import { workspaceNameSchema } from '@/lib/workspace/input-schemas'
import type { WorkspaceCreateInput } from '@/lib/workspace/schemas'

/** A slug from a name, with a short suffix so two teams named alike never collide. */
function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${base || 'team'}-${crypto.randomUUID().slice(0, 6)}`
}

/**
 * New team (RFC 043). A team is a workspace: its own members, roles, billing
 * and social sets. You become its owner, and it needs its own plan before it
 * can publish. Creating it does not move existing accounts or social sets.
 */
export function NewTeamSettings({ email }: { email: string }) {
  const trpcClient = useTRPCClient()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const attempt = useRef<WorkspaceCreateInput | null>(null)
  const pending = useRef(false)
  const parsed = workspaceNameSchema.safeParse(name)

  const create = async () => {
    if (!parsed.success || pending.current) return
    if (attempt.current?.name !== parsed.data) {
      attempt.current = {
        name: parsed.data,
        slug: slugFor(parsed.data),
        idempotencyKey: crypto.randomUUID(),
      }
    }
    pending.current = true
    setCreating(true)
    try {
      const { organization } = await trpcClient.workspace.create.mutate(attempt.current)
      await trpcClient.workspace.setActive.mutate({ organizationId: organization.id })
      toast.success(`${parsed.data} is ready. Invite people, then choose its plan in Billing.`)
      window.location.assign('/workspace/members')
    } catch (error) {
      toast.error(settingsErrorMessage(error))
      setCreating(false)
    } finally {
      pending.current = false
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void create()
      }}
    >
      <Group>
        <Row
          description="Teams share social sets for writing, review and scheduling. Each team is a separate workspace with its own members and plan."
          label="Workspace name"
          layout="stacked"
        >
          <Input
            aria-describedby="new-team-owner"
            aria-invalid={name.length > 0 && !parsed.success}
            aria-label="Workspace name"
            autoFocus
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder="Team, project, or client name"
            value={name}
          />
          <p className="text-xs text-muted-foreground" id="new-team-owner">
            You will be its owner, as {email}.
            {name.length > 0 && !parsed.success
              ? ' Use at least two characters that are not spaces.'
              : ''}
          </p>
        </Row>
      </Group>
      <div>
        <Button disabled={!parsed.success || creating} type="submit">
          {creating ? 'Creating…' : 'Create workspace'}
        </Button>
      </div>
    </form>
  )
}

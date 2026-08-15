'use client'

import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { organizationRoles } from '@/lib/auth/permissions'
import { getErrorMessage, requestJson } from './settings-client'

const memberSchema = z.object({
  id: z.string(),
  role: z.string(),
  user: z.object({ email: z.string().email(), name: z.string() }),
})
const membersSchema = z.object({ members: z.array(memberSchema) })
const invitationSchema = z.object({ email: z.string().email(), role: z.enum(organizationRoles) })

type WorkspaceMembersSettingsProps = { canManage: boolean; organizationId: string }
type WorkspaceMember = z.infer<typeof memberSchema>

export function WorkspaceMembersSettings({
  canManage,
  organizationId,
}: WorkspaceMembersSettingsProps) {
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const loadMembers = useCallback(async (): Promise<void> => {
    try {
      const result = await requestJson(
        `/api/auth/organization/list-members?organizationId=${organizationId}`,
        membersSchema
      )
      setMembers(result.members)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }, [organizationId])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  async function handleInvite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setMessage(null)
    const form = event.currentTarget
    const input = invitationSchema.safeParse(Object.fromEntries(new FormData(form)))
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? 'Check the invitation details.')
      return
    }
    setPendingId('invite')
    try {
      await requestJson('/api/auth/organization/invite-member', z.unknown(), {
        body: { ...input.data, organizationId },
        method: 'POST',
      })
      form.reset()
      setMessage('Invitation created.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPendingId(null)
    }
  }

  async function updateRole(member: WorkspaceMember, role: string): Promise<void> {
    setError(null)
    setPendingId(member.id)
    try {
      await requestJson('/api/auth/organization/update-member-role', z.unknown(), {
        body: { memberId: member.id, organizationId, role },
        method: 'POST',
      })
      await loadMembers()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPendingId(null)
    }
  }

  async function removeMember(member: WorkspaceMember): Promise<void> {
    setError(null)
    setPendingId(member.id)
    try {
      await requestJson('/api/auth/organization/remove-member', z.unknown(), {
        body: { memberIdOrEmail: member.id, organizationId },
        method: 'POST',
      })
      await loadMembers()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="grid max-w-3xl gap-8">
      {canManage ? (
        <InviteForm isSubmitting={pendingId === 'invite'} onSubmit={handleInvite} />
      ) : null}
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold">Members</h3>
        <div className="overflow-hidden rounded-md border border-foreground/10">
          {members.map((member) => (
            <MemberRow
              canManage={canManage}
              isPending={pendingId === member.id}
              key={member.id}
              member={member}
              onRemove={removeMember}
              onRoleChange={updateRole}
            />
          ))}
        </div>
      </div>
      {message ? <p className="rounded-md bg-primary/10 p-3 text-sm">{message}</p> : null}
      {error ? (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  )
}

function InviteForm({
  isSubmitting,
  onSubmit,
}: {
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <form className="grid gap-4 border-b border-foreground/10 pb-8" onSubmit={onSubmit}>
      <h3 className="text-sm font-semibold">Invite a member</h3>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
        <Input
          autoComplete="email"
          name="email"
          placeholder="teammate@company.com"
          required
          type="email"
        />
        <RoleSelect name="role" />
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Inviting…' : 'Invite'}
        </Button>
      </div>
    </form>
  )
}

function MemberRow({
  canManage,
  isPending,
  member,
  onRemove,
  onRoleChange,
}: {
  canManage: boolean
  isPending: boolean
  member: WorkspaceMember
  onRemove: (member: WorkspaceMember) => Promise<void>
  onRoleChange: (member: WorkspaceMember, role: string) => Promise<void>
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-foreground/10 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{member.user.name || member.user.email}</p>
        <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
      </div>
      {canManage ? (
        <div className="flex items-center gap-2">
          <RoleSelect
            disabled={isPending}
            onValueChange={(role) => void onRoleChange(member, role)}
            value={member.role}
          />
          <Button
            disabled={isPending}
            onClick={() => void onRemove(member)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Remove
          </Button>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">{member.role}</span>
      )}
    </div>
  )
}

function RoleSelect({
  disabled,
  name,
  onValueChange,
  value,
}: {
  disabled?: boolean
  name?: string
  onValueChange?: (role: string) => void
  value?: string
}) {
  return (
    <Select
      defaultValue={name ? 'viewer' : undefined}
      disabled={disabled}
      name={name}
      onValueChange={onValueChange}
      value={value}
    >
      <SelectTrigger className="h-10 w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {organizationRoles.map((role) => (
          <SelectItem key={role} value={role}>
            {role}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

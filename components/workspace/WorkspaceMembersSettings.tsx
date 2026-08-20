'use client'

import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'

const assignableRoles = ['admin', 'creator', 'approver', 'publisher', 'viewer'] as const
type AssignableRole = (typeof assignableRoles)[number]
const invitationSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(assignableRoles),
})

type WorkspaceMember = {
  id: string
  role: string
  user: { email: string; id: string; image: string | null; name: string }
}

type WorkspaceInvitation = {
  email: string
  expiresAt: Date
  id: string
  role: string | null
}

type Confirmation =
  | { member: WorkspaceMember; type: 'remove' | 'transfer' }
  | { type: 'leave' }
  | { invitation: WorkspaceInvitation; type: 'revoke' }

type WorkspaceMembersSettingsProps = {
  canInvite: boolean
  canManageMembers: boolean
  canRead: boolean
  canTransferOwnership: boolean
  currentUserId: string
}

export function WorkspaceMembersSettings({
  canInvite,
  canManageMembers,
  canRead,
  canTransferOwnership,
  currentUserId,
}: WorkspaceMembersSettingsProps) {
  const trpcClient = useTRPCClient()
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([])
  const [isLoading, setIsLoading] = useState(canRead)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!canRead) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      const [memberResult, invitationResult] = await Promise.all([
        trpcClient.workspace.listMembers.query(),
        canManageMembers ? trpcClient.workspace.listInvitations.query() : Promise.resolve(null),
      ])
      setMembers(memberResult.members)
      setInvitations(invitationResult?.invitations ?? [])
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsLoading(false)
    }
  }, [canManageMembers, canRead, trpcClient])

  useEffect(() => {
    void load()
  }, [load])

  async function run(
    actionId: string,
    action: () => Promise<unknown>,
    success: string
  ): Promise<void> {
    setError(null)
    setMessage(null)
    setPendingId(actionId)
    try {
      await action()
      await load()
      setMessage(success)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setConfirmation(null)
      setPendingId(null)
    }
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const form = event.currentTarget
    const input = invitationSchema.safeParse(Object.fromEntries(new FormData(form)))
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? 'Check the invitation details.')
      return
    }
    await run(
      'invite',
      async () => {
        await trpcClient.workspace.invite.mutate(input.data)
        form.reset()
      },
      'Invitation created.'
    )
  }

  async function confirmAction(): Promise<void> {
    if (!confirmation) return
    if (confirmation.type === 'remove') {
      await run(
        confirmation.member.id,
        () => trpcClient.workspace.removeMember.mutate({ memberId: confirmation.member.id }),
        'Member removed.'
      )
      return
    }
    if (confirmation.type === 'transfer') {
      await run(
        confirmation.member.id,
        () => trpcClient.workspace.transferOwnership.mutate({ memberId: confirmation.member.id }),
        'Ownership transferred.'
      )
      return
    }
    if (confirmation.type === 'revoke') {
      await run(
        confirmation.invitation.id,
        () =>
          trpcClient.workspace.revokeInvitation.mutate({
            invitationId: confirmation.invitation.id,
          }),
        'Invitation revoked.'
      )
      return
    }
    await run('leave', () => trpcClient.workspace.leave.mutate(), 'You left the workspace.')
  }

  if (!canRead) {
    return <p className="text-sm text-muted-foreground">Your role cannot view workspace members.</p>
  }

  return (
    <div className="grid max-w-3xl gap-8">
      {canInvite ? (
        <InviteForm isSubmitting={pendingId === 'invite'} onSubmit={handleInvite} />
      ) : null}
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Members</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading members…</p>
        ) : members.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            This workspace has no members yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-foreground/10">
            {members.map((member) => (
              <MemberRow
                canManage={canManageMembers}
                canTransferOwnership={canTransferOwnership}
                currentUserId={currentUserId}
                isPending={pendingId === member.id}
                key={member.id}
                member={member}
                onLeave={() => setConfirmation({ type: 'leave' })}
                onRemove={() => setConfirmation({ member, type: 'remove' })}
                onRoleChange={(role) =>
                  void run(
                    member.id,
                    () =>
                      trpcClient.workspace.updateMemberRole.mutate({ memberId: member.id, role }),
                    'Member role updated.'
                  )
                }
                onTransfer={() => setConfirmation({ member, type: 'transfer' })}
              />
            ))}
          </div>
        )}
      </section>
      {canManageMembers ? (
        <section className="grid gap-3">
          <h3 className="text-sm font-semibold">Pending invitations</h3>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading invitations…</p>
          ) : invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invitations are pending.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-foreground/10">
              {invitations.map((invitation) => (
                <div
                  className="flex flex-col gap-3 border-b border-foreground/10 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                  key={invitation.id}
                >
                  <div>
                    <p className="text-sm font-medium">{invitation.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {invitation.role ?? 'viewer'} · expires{' '}
                      {new Date(invitation.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={pendingId === invitation.id}
                      onClick={() =>
                        void run(
                          invitation.id,
                          () =>
                            trpcClient.workspace.resendInvitation.mutate({
                              invitationId: invitation.id,
                            }),
                          'Invitation resent.'
                        )
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Resend
                    </Button>
                    <Button
                      disabled={pendingId === invitation.id}
                      onClick={() => setConfirmation({ invitation, type: 'revoke' })}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
      {message ? <p className="rounded-md bg-primary/10 p-3 text-sm">{message}</p> : null}
      {error ? (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : null}
      <ConfirmationDialog
        confirmation={confirmation}
        isPending={pendingId !== null}
        onConfirm={() => void confirmAction()}
        onOpenChange={(open) => !open && setConfirmation(null)}
      />
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
  canTransferOwnership,
  currentUserId,
  isPending,
  member,
  onLeave,
  onRemove,
  onRoleChange,
  onTransfer,
}: {
  canManage: boolean
  canTransferOwnership: boolean
  currentUserId: string
  isPending: boolean
  member: WorkspaceMember
  onLeave: () => void
  onRemove: () => void
  onRoleChange: (role: AssignableRole) => void
  onTransfer: () => void
}) {
  const isCurrentUser = member.user.id === currentUserId
  const isOwner = member.role === 'owner'
  return (
    <div className="flex flex-col gap-3 border-b border-foreground/10 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {member.user.name || member.user.email}
          {isCurrentUser ? ' (you)' : ''}
        </p>
        <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
      </div>
      {canManage && !isOwner ? (
        <div className="flex flex-wrap items-center gap-2">
          <RoleSelect disabled={isPending} onValueChange={onRoleChange} value={member.role} />
          {canTransferOwnership ? (
            <Button
              disabled={isPending}
              onClick={onTransfer}
              size="sm"
              type="button"
              variant="outline"
            >
              Make owner
            </Button>
          ) : null}
          <Button
            disabled={isPending}
            onClick={isCurrentUser ? onLeave : onRemove}
            size="sm"
            type="button"
            variant="ghost"
          >
            {isCurrentUser ? 'Leave' : 'Remove'}
          </Button>
        </div>
      ) : isCurrentUser && !isOwner ? (
        <Button disabled={isPending} onClick={onLeave} size="sm" type="button" variant="ghost">
          Leave
        </Button>
      ) : (
        <span className="text-sm capitalize text-muted-foreground">{member.role}</span>
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
  onValueChange?: (role: AssignableRole) => void
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
        {assignableRoles.map((role) => (
          <SelectItem key={role} value={role}>
            {role}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ConfirmationDialog({
  confirmation,
  isPending,
  onConfirm,
  onOpenChange,
}: {
  confirmation: Confirmation | null
  isPending: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const copy =
    confirmation?.type === 'transfer'
      ? {
          action: 'Transfer ownership',
          body: `This makes ${confirmation.member.user.email} the owner and changes your role to admin.`,
        }
      : confirmation?.type === 'remove'
        ? {
            action: 'Remove member',
            body: `Remove ${confirmation.member.user.email} from this workspace?`,
          }
        : confirmation?.type === 'revoke'
          ? {
              action: 'Revoke invitation',
              body: `Revoke the invitation for ${confirmation.invitation.email}?`,
            }
          : { action: 'Leave workspace', body: 'You will lose access to this workspace.' }
  return (
    <AlertDialog onOpenChange={onOpenChange} open={confirmation !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.action}</AlertDialogTitle>
          <AlertDialogDescription>{copy.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={onConfirm}>
            {isPending ? 'Working…' : copy.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
